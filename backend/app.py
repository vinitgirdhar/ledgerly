from __future__ import annotations

import json
import os
import re
import uuid
from datetime import timedelta
from pathlib import Path

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
import pytesseract
from PIL import Image
from pdf2image import convert_from_path
import google.generativeai as genai
import cv2
import numpy as np

from db import connect, default_db_path, init_db, query_one, query_all, exec_one

# Configure Tesseract path with env override and PATH fallback
_default_tesseract = Path(r"C:\\Program Files\\Tesseract-OCR\\tesseract.exe")
_env_tesseract = os.environ.get("TESSERACT_CMD")

if _env_tesseract and Path(_env_tesseract).exists():
    pytesseract.pytesseract.tesseract_cmd = _env_tesseract
elif _default_tesseract.exists():
    pytesseract.pytesseract.tesseract_cmd = str(_default_tesseract)
else:
    # Leave pytesseract to search PATH; helpful message on failure
    print("[ledgerly] Tesseract executable not found at default location; relying on PATH.")

# Gemini Vision API key (optional) and model override
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Allowed file extensions for bill uploads
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "pdf"}

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def _clean_json_text(raw_text: str) -> str:
    """Extract JSON from LLM response (handles ```json blocks)."""
    text = raw_text.strip()
    if "```" in text:
        # Find content between ``` markers
        parts = text.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{"):
                return part
    return text

# ================================
# 🔥 STEP 1: IMAGE PREPROCESSING
# ================================
def preprocess_bill_image(image_path: Path) -> Path:
    """
    Preprocess bill image for better OCR and LLM accuracy.
    - Converts to grayscale
    - Applies adaptive thresholding to remove shadows
    - Enhances handwriting visibility
    """
    try:
        img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
        if img is None:
            return image_path  # Return original if can't read
        
        # Adaptive threshold - removes shadows, enhances text
        processed = cv2.adaptiveThreshold(
            img, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            11, 2
        )
        
        # Save processed image alongside original
        processed_path = image_path.parent / f"processed_{image_path.name}"
        cv2.imwrite(str(processed_path), processed)
        return processed_path
    except Exception:
        return image_path  # Return original on any error


def pdf_to_image(pdf_path: Path) -> Path:
    """Convert first page of PDF to an image file and return its path."""
    poppler_path = os.environ.get("POPPLER_PATH")  # Optional: path to poppler bin on Windows
    try:
        images = convert_from_path(str(pdf_path), first_page=1, last_page=1, poppler_path=poppler_path)
        if not images:
            return pdf_path
        out_path = pdf_path.with_suffix(".png")
        images[0].save(out_path, "PNG")
        return out_path
    except Exception as e:
        print(f"[ledgerly] PDF conversion failed: {e}")
        return pdf_path

# ================================
# 🎯 STEP 3: EXTRACTION_PROMPT
# ================================
EXTRACTION_PROMPT = """
Analyze this Indian GST bill and extract the following information in JSON format:
{
  "vendor_name": "",
  "vendor_gstin": "",
  "bill_number": "",
  "bill_date": "",
  "items": [
    {
      "description": "",
      "hsn_code": "",
      "quantity": 0,
      "rate": 0,
      "amount": 0
    }
  ],
  "subtotal": 0,
  "cgst_rate": 0,
  "cgst_amount": 0,
  "sgst_rate": 0,
  "sgst_amount": 0,
  "igst_rate": 0,
  "igst_amount": 0,
  "total_amount": 0
}

Return ONLY valid JSON, no markdown formatting.

OCR hints (may be inaccurate):
<<<{ocr_text}>>>
"""

# ================================
# 🔁 STEP 4: VERIFICATION_PROMPT
# ================================
VERIFICATION_PROMPT = """You are a strict financial auditor AI.

Given:
1) The original bill image
2) Extracted JSON below

Extracted data:
<<<{extracted_json}>>>

Your job:
- Verify numerical consistency
- Check if total_amount = subtotal + cgst_amount + sgst_amount + igst_amount
- Ensure totals look visually plausible against the bill image
- Fix obvious mistakes
- If unsure, set fields to null or 0.

Return ONLY the corrected JSON (same schema, no explanations)."""

# ================================
# 🎙️ VOICE EXTRACTION PROMPT
# ================================
VOICE_EXTRACTION_PROMPT = """
Analyze this voice transcript for an accounting entry and extract the following information in JSON format:
{
  "entry_type": "income" | "expense",
  "amount": 0,
  "note": "Description of the transaction",
  "items": [
    {
      "name": "item name",
      "quantity": 1,
      "unit": "kg/pcs/etc",
      "price": 0
    }
  ]
}

Transcript: "{transcript}"
"""

# ================================
# 🧪 STEP 5: RULE-BASED VALIDATION
# ================================
def validate_bill_data(bill: dict) -> dict:
    """Apply rule-based validation to prevent embarrassing errors."""
    if bill is None:
        return None
    
    total = bill.get("total_amount")
    gst = bill.get("gst_amount")
    subtotal = bill.get("subtotal")
    confidence = bill.get("confidence", 0.5)
    
    # Rule 1: Total should be at least ₹10
    if total is not None and total < 10:
        confidence -= 0.2
    
    # Rule 2: GST cannot exceed total
    if gst is not None and total is not None and gst > total:
        bill["gst_amount"] = None
        confidence -= 0.15
    
    # Rule 3: GST percentage sanity check (0-28% in India)
    gst_pct = bill.get("gst_percentage")
    if gst_pct is not None and (gst_pct < 0 or gst_pct > 28):
        bill["gst_percentage"] = None
        confidence -= 0.1
    
    # Rule 4: Subtotal + GST should approximately equal total
    if subtotal is not None and gst is not None and total is not None:
        expected = subtotal + gst
        if abs(expected - total) > total * 0.1:  # >10% mismatch
            confidence -= 0.15
    
    # Rule 5: If no items extracted, lower confidence
    items = bill.get("items", [])
    if not items:
        confidence -= 0.1
    
    # Clamp confidence to valid range
    bill["confidence"] = max(0.0, min(1.0, confidence))
    
    return bill


def _fallback_extract_from_ocr(ocr_text: str) -> dict:
    """Improved regex-based extraction used when no Gemini API key is set."""
    # Amount detection - comprehensive patterns for Indian bills
    amount_patterns = [
        # Specific total patterns (higher priority)
        r"(?:Grand\s*Total|Net\s*Amount|Total\s*Amount|Amount\s*Payable)[:\s]*(?:₹|Rs\.?|INR)?\s*([\d,]+\.?\d*)",
        r"(?:Grand\s*Total|Net\s*Amount|Total\s*Amount|Amount\s*Payable)[:\s]*([\d,]+\.?\d*)",
        r"(?:₹|Rs\.?|INR)\s*([\d,]+\.?\d*)\s*(?:only|/-)?",
        r"Total[:\s]*(?:₹|Rs\.?|INR)?\s*([\d,]+\.?\d*)",
        r"Amount[:\s]*(?:₹|Rs\.?|INR)?\s*([\d,]+\.?\d*)",
        # Generic currency patterns
        r"(?:₹|Rs\.?|INR)\s*([\d,]+\.?\d*)",
        # Fallback: numbers with decimal places (likely amounts)
        r"\b([\d,]+\.\d{2})\b",
        # Last resort: any large number (>100) could be an amount
        r"\b(\d{3,}(?:,\d{3})*(?:\.\d{2})?)\b",
    ]
    
    # Collect all potential amounts
    all_amounts = []
    for pattern in amount_patterns:
        matches = re.findall(pattern, ocr_text, re.IGNORECASE)
        for match in matches:
            try:
                amt = float(match.replace(",", ""))
                if amt > 0:
                    all_amounts.append(amt)
            except ValueError:
                continue
    
    # Use the largest amount as the total (common pattern in bills)
    detected_amount = max(all_amounts) if all_amounts else None
    
    # GSTIN detection (15 alphanumeric: 2 digits + 10 alphanumeric + 1 digit + 1 alphanumeric + 1 alphanumeric)
    gstin_pattern = r"\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2})\b"
    gstin_match = re.search(gstin_pattern, ocr_text.upper())
    vendor_gstin = gstin_match.group(1) if gstin_match else None

    # Date detection (multiple formats)
    date_patterns = [
        r"(?:Date|Dt\.?|Dated)[:\s]*(\d{1,2}[\-/\.]\d{1,2}[\-/\.]\d{2,4})",
        r"(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4})",
        r"(\d{4}[\-/]\d{1,2}[\-/]\d{1,2})",
        r"(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})",
    ]
    bill_date = None
    for pattern in date_patterns:
        m = re.search(pattern, ocr_text, re.IGNORECASE)
        if m:
            bill_date = m.group(1)
            break

    # Bill/Invoice number detection
    bill_number = None
    bill_num_patterns = [
        r"(?:Invoice|Bill|Receipt)\s*(?:No\.?|Number|#)[:\s]*([A-Z0-9\-/]+)",
        r"(?:No\.?|#)[:\s]*([A-Z0-9\-/]{3,})",
    ]
    for pattern in bill_num_patterns:
        m = re.search(pattern, ocr_text, re.IGNORECASE)
        if m:
            bill_number = m.group(1)
            break

    # GST amount detection
    cgst_amount = None
    sgst_amount = None
    igst_amount = None
    
    cgst_match = re.search(r"CGST[:\s@%\d]*(?:₹|Rs\.?)?\s*([\d,]+\.?\d*)", ocr_text, re.IGNORECASE)
    if cgst_match:
        try:
            cgst_amount = float(cgst_match.group(1).replace(",", ""))
        except ValueError:
            pass
    
    sgst_match = re.search(r"SGST[:\s@%\d]*(?:₹|Rs\.?)?\s*([\d,]+\.?\d*)", ocr_text, re.IGNORECASE)
    if sgst_match:
        try:
            sgst_amount = float(sgst_match.group(1).replace(",", ""))
        except ValueError:
            pass
            
    igst_match = re.search(r"IGST[:\s@%\d]*(?:₹|Rs\.?)?\s*([\d,]+\.?\d*)", ocr_text, re.IGNORECASE)
    if igst_match:
        try:
            igst_amount = float(igst_match.group(1).replace(",", ""))
        except ValueError:
            pass

    # Subtotal/taxable amount
    subtotal = None
    subtotal_match = re.search(r"(?:Sub\s*Total|Taxable\s*(?:Value|Amount))[:\s]*(?:₹|Rs\.?)?\s*([\d,]+\.?\d*)", ocr_text, re.IGNORECASE)
    if subtotal_match:
        try:
            subtotal = float(subtotal_match.group(1).replace(",", ""))
        except ValueError:
            pass

    # Vendor name: first non-empty line that looks like a business name
    vendor_name = None
    lines = ocr_text.splitlines()
    skip_labels = ["invoice", "bill", "date", "gst", "total", "amount", "tax", "receipt", "cash", "credit", "payment"]
    for line in lines[:10]:  # Check first 10 lines only
        line = line.strip()
        if not line or len(line) < 3:
            continue
        line_lower = line.lower()
        # Skip lines that are clearly labels or numbers
        if any(label in line_lower for label in skip_labels):
            continue
        if re.match(r"^[\d\s\-/\.,:₹]+$", line):  # Skip pure number/date lines
            continue
        # Likely a vendor name
        vendor_name = line[:50]  # Limit length
        break

    # Calculate confidence based on what we found
    confidence = 0.3  # Base confidence
    if detected_amount and detected_amount > 10:
        confidence += 0.25
    if vendor_gstin:
        confidence += 0.15
    if bill_date:
        confidence += 0.1
    if vendor_name:
        confidence += 0.1
    if cgst_amount or sgst_amount or igst_amount:
        confidence += 0.1

    return {
        "vendor_name": vendor_name,
        "vendor_gstin": vendor_gstin,
        "bill_number": bill_number,
        "bill_date": bill_date,
        "items": [],
        "subtotal": subtotal,
        "cgst_rate": None,
        "cgst_amount": cgst_amount,
        "sgst_rate": None,
        "sgst_amount": sgst_amount,
        "igst_rate": None,
        "igst_amount": igst_amount,
        "total_amount": detected_amount,
        "confidence": min(1.0, confidence),
    }

def extract_voice_data_simple(transcript: str) -> dict:
    """Fallback extraction using regex for voice data.
    
    Handles Hinglish patterns like:
    - "5 kilo chawal 500 rupaye mein becha" -> amount=500, type=income
    - "200 rupees ka rice kharida" -> amount=200, type=expense
    - "received 1000 from customer" -> amount=1000, type=income
    """
    import re
    text_lower = transcript.lower()
    
    amount = 0
    
    # Priority 1: Look for currency patterns (rupaye/rupees/rs/₹ followed/preceded by number)
    # Pattern: number + rupaye/rupees/rs OR ₹ + number
    currency_patterns = [
        r"(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rupaye|rupees|rupiya|rs\.?|₹)",  # 500 rupaye
        r"(?:rupaye|rupees|rupiya|rs\.?|₹)\s*(\d+(?:,\d+)*(?:\.\d+)?)",  # rs 500
        r"(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:ka|ke|ki|mein|me|में)",  # 500 ka (Hindi pattern)
    ]
    
    for pattern in currency_patterns:
        match = re.search(pattern, text_lower)
        if match:
            amount_str = match.group(1).replace(",", "")
            try:
                amount = float(amount_str)
                break
            except ValueError:
                continue
    
    # Priority 2: If no currency pattern found, look for the largest number (likely the amount)
    if amount == 0:
        all_numbers = re.findall(r"(\d+(?:,\d+)*(?:\.\d+)?)", transcript)
        if all_numbers:
            numbers = [float(n.replace(",", "")) for n in all_numbers]
            # Take the largest number as the amount
            amount = max(numbers)
    
    # Determine entry type based on keywords
    entry_type = "expense"  # Default
    income_keywords = ["sold", "received", "income", "becha", "bech", "diya", "milaa", "mila", "aaya", "aayi", "payment received"]
    expense_keywords = ["bought", "purchased", "kharida", "liya", "spent", "paid", "expense"]
    
    for keyword in income_keywords:
        if keyword in text_lower:
            entry_type = "income"
            break
    
    # Check expense keywords only if not already marked as income
    if entry_type == "income":
        for keyword in expense_keywords:
            if keyword in text_lower:
                # Income keywords take precedence, but check context
                break
    else:
        for keyword in expense_keywords:
            if keyword in text_lower:
                entry_type = "expense"
                break
        
    return {
        "entry_type": entry_type,
        "amount": amount,
        "note": transcript,
        "items": []
    }

# ================================
# 🧠 MAIN EXTRACTION PIPELINE
# ================================
def run_gemini_structured(image_path: Path, ocr_text: str) -> dict | None:
    """
    Complete bill extraction pipeline:
    1. Preprocess image
    2. Extract with Gemini Vision
    3. Verify with second LLM pass
    4. Apply rule-based validation
    """
    if not GEMINI_API_KEY:
        return _fallback_extract_from_ocr(ocr_text)

    try:
        # Preprocess image for better accuracy
        processed_path = preprocess_bill_image(image_path)
        
        # Load image for Gemini (ensure RGB)
        pil_image = Image.open(processed_path).convert("RGB")
        
        # STEP 3: First extraction pass
        extraction_prompt = EXTRACTION_PROMPT.format(ocr_text=ocr_text)
        model_name = GEMINI_MODEL or "gemini-2.0-flash"
        model = genai.GenerativeModel(model_name)
        
        response = model.generate_content([extraction_prompt, pil_image])
        raw = response.text or ""
        extracted = json.loads(_clean_json_text(raw))
        
        if not isinstance(extracted, dict):
            return None
        
        # STEP 4: Verification pass (second LLM call)
        try:
            verify_prompt = VERIFICATION_PROMPT.format(
                extracted_json=json.dumps(extracted, indent=2)
            )
            verify_response = model.generate_content([verify_prompt, pil_image])
            verify_raw = verify_response.text or ""
            verified = json.loads(_clean_json_text(verify_raw))
            
            if isinstance(verified, dict):
                extracted = verified  # Use verified version
        except Exception:
            pass  # Keep original extraction if verification fails
        
        # STEP 5: Rule-based validation
        validated = validate_bill_data(extracted)
        
        # Cleanup processed image
        if processed_path != image_path and processed_path.exists():
            try:
                processed_path.unlink()
            except Exception:
                pass
        
        return validated
        
    except Exception as e:
        print(f"Gemini extraction error: {e}")
        return None

FRONTEND_DIR = Path(__file__).resolve().parents[1]
PAGES_DIR = FRONTEND_DIR / "pages"
STYLES_DIR = FRONTEND_DIR / "styles"
SCRIPTS_DIR = FRONTEND_DIR / "script"
UPLOADS_DIR = FRONTEND_DIR / "uploads"
BILLS_UPLOAD_DIR = UPLOADS_DIR / "bills"


def create_app() -> Flask:
    app = Flask(__name__)

    # Use an env var in real deployments.
    app.secret_key = os.environ.get("LEDGERLY_SECRET_KEY", "dev-secret-change-me")
    app.permanent_session_lifetime = timedelta(days=14)

    db_path = Path(os.environ.get("LEDGERLY_DB_PATH", str(default_db_path())))
    init_db(db_path)
    BILLS_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    def ensure_demo_user() -> None:
        with connect(db_path) as conn:
            existing = query_one(conn, "SELECT id FROM users WHERE email = ?", ("demo@ledgerly.in",))
            if existing is None:
                pwd_hash = generate_password_hash("Ledgerly@123")
                exec_one(
                    conn,
                    "INSERT INTO users (username, email, password_hash) VALUES (?,?,?)",
                    ("Demo Owner", "demo@ledgerly.in", pwd_hash),
                )

    ensure_demo_user()

    @app.after_request
    def add_header(response):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    def get_conn():
        return connect(db_path)

    def current_user_id() -> int | None:
        user_id = session.get("user_id")
        return int(user_id) if user_id is not None else None

    def require_login() -> int:
        user_id = current_user_id()
        if not user_id:
            return 0
        return user_id

    # -------------------------
    # Frontend file serving
    # -------------------------
    @app.get("/")
    def serve_index():
        return send_from_directory(PAGES_DIR, "index.html")

    @app.get("/dashboard")
    def serve_dashboard():
        return send_from_directory(PAGES_DIR, "dashboard.html")

    @app.get("/insights")
    def serve_insights():
        return send_from_directory(PAGES_DIR, "insights.html")

    @app.get("/<path:path>")
    def serve_static(path: str):
        # Prevent API paths from being treated as files.
        if path.startswith("api/"):
            return jsonify({"error": "not_found"}), 404

        if path.startswith("styles/"):
            inner = path.split("/", 1)[1]
            return send_from_directory(STYLES_DIR, inner)

        if path.startswith("script/"):
            inner = path.split("/", 1)[1]
            return send_from_directory(SCRIPTS_DIR, inner)

        if path.startswith("uploads/"):
            inner = path.split("/", 1)[1]
            return send_from_directory(UPLOADS_DIR, inner)

        page_candidate = PAGES_DIR / path
        if page_candidate.is_file():
            return send_from_directory(PAGES_DIR, path)

        full_path = FRONTEND_DIR / path
        if full_path.is_file():
            return send_from_directory(FRONTEND_DIR, path)

        # Friendly default
        return jsonify({"error": "not_found"}), 404

    # -------------------------
    # Auth API
    # -------------------------
    @app.post("/api/register")
    def api_register():
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        if not username:
            return jsonify({"error": "username_required"}), 400
        if "@" not in email:
            return jsonify({"error": "email_invalid"}), 400
        if len(password) < 8:
            return jsonify({"error": "password_too_short"}), 400

        pwd_hash = generate_password_hash(password)

        try:
            with get_conn() as conn:
                user_id = exec_one(
                    conn,
                    "INSERT INTO users (username, email, password_hash) VALUES (?,?,?)",
                    (username, email, pwd_hash),
                )
        except Exception:
            # Most likely email uniqueness violation.
            return jsonify({"error": "user_exists"}), 409

        return jsonify({"ok": True, "user": {"id": user_id, "username": username, "email": email}})

    @app.post("/api/login")
    def api_login():
        data = request.get_json(silent=True) or {}
        identifier = (data.get("identifier") or "").strip()
        password = data.get("password") or ""
        remember = bool(data.get("remember"))

        if not identifier:
            return jsonify({"error": "identifier_required"}), 400
        if len(password) < 8:
            return jsonify({"error": "password_invalid"}), 400

        with get_conn() as conn:
            row = query_one(
                conn,
                """
                SELECT id, username, email, password_hash
                FROM users
                WHERE lower(email) = lower(?) OR lower(username) = lower(?)
                LIMIT 1
                """,
                (identifier, identifier),
            )

        if row is None:
            return jsonify({"error": "invalid_credentials", "message": "Unknown email/username or wrong password."}), 401

        if not check_password_hash(row["password_hash"], password):
            return jsonify({"error": "invalid_credentials", "message": "Unknown email/username or wrong password."}), 401

        session.clear()
        session["user_id"] = int(row["id"])
        session.permanent = remember

        return jsonify({"ok": True, "user": {"id": int(row["id"]), "username": row["username"], "email": row["email"]}})

    @app.post("/api/logout")
    def api_logout():
        session.clear()
        return jsonify({"ok": True})

    @app.get("/api/me")
    def api_me():
        user_id = current_user_id()
        if not user_id:
            return jsonify({"ok": True, "user": None})

        with get_conn() as conn:
            row = query_one(conn, "SELECT id, username, email FROM users WHERE id = ?", (user_id,))

        if row is None:
            session.clear()
            return jsonify({"ok": True, "user": None})

        return jsonify({"ok": True, "user": {"id": int(row["id"]), "username": row["username"], "email": row["email"]}})

    # -------------------------
    # Example data API (ledger entries)
    # -------------------------
    @app.get("/api/entries")
    def api_list_entries():
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        with get_conn() as conn:
            rows = query_all(
                conn,
                "SELECT id, entry_type, amount, note, source, created_at FROM entries WHERE user_id = ? ORDER BY id DESC",
                (user_id,),
            )

        return jsonify({"ok": True, "entries": [dict(r) for r in rows]})

    @app.post("/api/entries")
    def api_create_entry():
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        data = request.get_json(silent=True) or {}
        entry_type = (data.get("entry_type") or "").strip().lower()
        note = (data.get("note") or "").strip() or None
        amount = data.get("amount")

        if entry_type not in {"income", "expense"}:
            return jsonify({"error": "entry_type_invalid"}), 400

        if amount is None:
            return jsonify({"error": "amount_invalid"}), 400

        try:
            amount_val = float(amount)
        except Exception:
            return jsonify({"error": "amount_invalid"}), 400

        with get_conn() as conn:
            entry_id = exec_one(
                conn,
                "INSERT INTO entries (user_id, entry_type, amount, note) VALUES (?,?,?,?)",
                (user_id, entry_type, amount_val, note),
            )

        return jsonify({"ok": True, "entry": {"id": entry_id, "entry_type": entry_type, "amount": amount_val, "note": note}})
    
    # -------------------------
    # Voice Entry API (Added)
    # -------------------------
    @app.post("/api/voice/process")
    def api_process_voice():
        """Process voice transcript and create ledger entry."""
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        data = request.get_json(silent=True) or {}
        transcript = (data.get("transcript") or "").strip()

        if not transcript:
            return jsonify({"error": "transcript_required"}), 400

        try:
            extracted = None
            
            # Try Gemini extraction first (if API key available)
            if GEMINI_API_KEY:
                try:
                    prompt = VOICE_EXTRACTION_PROMPT.format(transcript=transcript)
                    model_name = GEMINI_MODEL if 'GEMINI_MODEL' in globals() else "gemini-2.0-flash"
                    model = genai.GenerativeModel(model_name)
                    # Helper for response handling
                    response = model.generate_content(prompt)
                    raw = response.text or ""
                    cleaned = _clean_json_text(raw)
                    extracted = json.loads(cleaned)
                except Exception as e:
                    print(f"Gemini extraction failed: {e}, falling back to simple extraction")
                    extracted = None

            # Fallback to simple regex extraction
            if not extracted:
                extracted = extract_voice_data_simple(transcript)

            # Validate extracted data
            entry_type = extracted.get("entry_type", "income")
            if entry_type not in {"income", "expense"}:
                entry_type = "income"

            amount = extracted.get("amount", 0)
            if not amount or amount <= 0:
                # Try to extract amount from transcript directly
                import re
                amount_match = re.search(r"([\d,]+\.?\d*)", transcript)
                if amount_match:
                    try:
                        amount = float(amount_match.group(1).replace(",", ""))
                    except ValueError:
                        pass

            if amount <= 0:
                return jsonify({"error": "amount_not_found", "message": "Could not extract amount from transcript."}), 400

            note = extracted.get("note") or transcript
            items = extracted.get("items", [])
            
            # Format note with item details if available
            if items:
                item_strs = []
                for item in items:
                    qty = item.get("quantity", 1)
                    unit = item.get("unit", "")
                    name = item.get("name", "")
                    price = item.get("price")
                    if price:
                        item_strs.append(f"{qty} {unit} {name} @ ₹{price:.2f}")
                    else:
                        item_strs.append(f"{qty} {unit} {name}")
                if item_strs:
                    note = f"{transcript} | Items: {', '.join(item_strs)}"

            # Create ledger entry
            with get_conn() as conn:
                entry_id = exec_one(
                    conn,
                    "INSERT INTO entries (user_id, entry_type, amount, note, source) VALUES (?,?,?,?,?)",
                    (user_id, entry_type, float(amount), note, 'voice'),
                )

                # Fetch the created entry
                row = query_one(
                    conn,
                    "SELECT id, entry_type, amount, note, source, created_at FROM entries WHERE id = ?",
                    (entry_id,),
                )

            return jsonify({
                "ok": True,
                "entry": dict(row),
                "items": items,
            })

        except json.JSONDecodeError as e:
            return jsonify({"error": "extraction_failed", "message": f"Failed to parse extracted data: {str(e)}"}), 500
        except Exception as e:
            print(f"Voice processing error: {e}")
            return jsonify({"error": "processing_failed", "message": str(e)}), 500

    # -------------------------
    # Business Profile API
    # -------------------------
    def calculate_profile_completion(profile: dict) -> int:
        """Calculate profile completion percentage based on filled fields."""
        score = 0
        if profile.get("business_name"):
            score += 33
        if profile.get("gstin"):
            score += 34
        if profile.get("business_type"):
            score += 33
        return min(100, score)

    def validate_gstin(gstin: str) -> bool:
        """Validate GSTIN format (15 alphanumeric characters)."""
        if not gstin or len(gstin) != 15:
            return False
        return gstin.isalnum()

    @app.get("/api/profile")
    def api_get_profile():
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        with get_conn() as conn:
            profile = query_one(
                conn,
                """SELECT business_name, gstin, business_type, address, phone,
                          bank_name, bank_account_number, bank_ifsc,
                          profile_completion_pct, catalog_completion_pct,
                          inventory_completion_pct, integrations_completion_pct
                   FROM business_profiles WHERE user_id = ?""",
                (user_id,)
            )

        if profile is None:
            # Return default empty profile
            return jsonify({
                "ok": True,
                "profile": {
                    "business_name": None,
                    "gstin": None,
                    "business_type": None,
                    "address": None,
                    "phone": None,
                    "bank_name": None,
                    "bank_account_number": None,
                    "bank_ifsc": None,
                    "profile_completion_pct": 0,
                    "catalog_completion_pct": 0,
                    "inventory_completion_pct": 0,
                    "integrations_completion_pct": 0
                }
            })

        return jsonify({"ok": True, "profile": dict(profile)})

    @app.post("/api/profile")
    def api_update_profile():
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        data = request.get_json(silent=True) or {}
        business_name = (data.get("business_name") or "").strip() or None
        gstin = (data.get("gstin") or "").strip().upper() or None
        business_type = (data.get("business_type") or "").strip().lower() or None
        address = (data.get("address") or "").strip() or None
        phone = (data.get("phone") or "").strip() or None
        bank_name = (data.get("bank_name") or "").strip() or None
        bank_account_number = (data.get("bank_account_number") or "").strip() or None
        bank_ifsc = (data.get("bank_ifsc") or "").strip().upper() or None

        # Validate GSTIN if provided
        if gstin and not validate_gstin(gstin):
            return jsonify({"error": "gstin_invalid", "message": "GSTIN must be 15 alphanumeric characters"}), 400

        # Validate business type
        if business_type and business_type not in {"retail", "wholesale", "services", "other"}:
            return jsonify({"error": "business_type_invalid"}), 400

        # Calculate completion percentage
        profile_data = {
            "business_name": business_name,
            "gstin": gstin,
            "business_type": business_type
        }
        completion_pct = calculate_profile_completion(profile_data)

        with get_conn() as conn:
            # Check if profile exists
            existing = query_one(conn, "SELECT id FROM business_profiles WHERE user_id = ?", (user_id,))

            if existing:
                # Update existing profile
                conn.execute(
                    """UPDATE business_profiles SET
                       business_name = ?, gstin = ?, business_type = ?, address = ?, phone = ?,
                       bank_name = ?, bank_account_number = ?, bank_ifsc = ?,
                       profile_completion_pct = ?, updated_at = datetime('now')
                       WHERE user_id = ?""",
                    (business_name, gstin, business_type, address, phone,
                     bank_name, bank_account_number, bank_ifsc, completion_pct, user_id)
                )
            else:
                # Create new profile
                exec_one(
                    conn,
                    """INSERT INTO business_profiles
                       (user_id, business_name, gstin, business_type, address, phone,
                        bank_name, bank_account_number, bank_ifsc, profile_completion_pct)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (user_id, business_name, gstin, business_type, address, phone,
                     bank_name, bank_account_number, bank_ifsc, completion_pct)
                )

            # Fetch updated profile
            profile = query_one(
                conn,
                """SELECT business_name, gstin, business_type, address, phone,
                          bank_name, bank_account_number, bank_ifsc,
                          profile_completion_pct, catalog_completion_pct,
                          inventory_completion_pct, integrations_completion_pct
                   FROM business_profiles WHERE user_id = ?""",
                (user_id,)
            )

        return jsonify({"ok": True, "profile": dict(profile)})

    # -------------------------
    # Bills / OCR API
    # -------------------------
    @app.post("/api/bills/upload")
    def api_upload_bill():
        """Upload a bill image locally and extract text via OCR."""
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        if "file" not in request.files:
            return jsonify({"error": "no_file"}), 400

        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "empty_filename"}), 400

        if not allowed_file(file.filename):
            return jsonify({"error": "invalid_file_type", "message": "Only image files (PNG, JPG, PDF, etc.) are allowed."}), 400

        try:
            # Secure the filename and create unique storage key
            original_filename = secure_filename(file.filename)
            unique_id = uuid.uuid4().hex
            stored_filename = f"{unique_id}_{original_filename}"
            local_path = BILLS_UPLOAD_DIR / stored_filename
            public_url = f"/uploads/bills/{stored_filename}"

            # Save locally
            file.save(local_path)

            # Insert bill record with status 'processing'
            with get_conn() as conn:
                bill_id = exec_one(
                    conn,
                    """INSERT INTO bills (user_id, filename, s3_key, s3_url, status)
                       VALUES (?, ?, ?, ?, 'processing')""",
                    (user_id, original_filename, str(local_path), public_url),
                )

                # Ensure image path (convert PDF first pages to image)
                image_path = pdf_to_image(local_path) if local_path.suffix.lower() == ".pdf" else local_path

                # If conversion failed (still PDF), return clear error about Poppler setup
                if image_path.suffix.lower() == ".pdf":
                    return jsonify({
                        "error": "pdf_conversion_failed",
                        "message": (
                            "Could not convert PDF to image. Install Poppler and set POPPLER_PATH to its bin folder, "
                            "then restart the server."
                        )
                    }), 500

                # Run Tesseract OCR on local file
                try:
                    image = Image.open(image_path)
                    ocr_text = pytesseract.image_to_string(image)
                except pytesseract.TesseractNotFoundError:
                    return jsonify({
                        "error": "tesseract_missing",
                        "message": (
                            "Tesseract executable not found. Set TESSERACT_CMD to your tesseract.exe path "
                            "or add it to PATH, then restart the server."
                        )
                    }), 500
                except Exception as e:
                    return jsonify({
                        "error": "ocr_failed",
                        "message": f"Failed to read image/PDF: {e}"
                    }), 500

            # Use Gemini Vision to structure data (optional)
            structured = run_gemini_structured(image_path, ocr_text) or {}

            # If LLM/gemini returned nothing useful, fall back to OCR regex extraction
            if not structured or (structured.get("total_amount") in (None, 0) and not structured.get("items")):
                structured = _fallback_extract_from_ocr(ocr_text)

            # Minimal item spotting heuristic: if no items but we have a total, create a single inferred line item
            if structured.get("items") in (None, [], ()):  # empty items
                total_val = structured.get("total_amount") or structured.get("detected_amount")
                if total_val:
                    structured["items"] = [{
                        "description": "Inferred item",
                        "hsn_code": None,
                        "quantity": 1,
                        "rate": total_val,
                        "amount": total_val
                    }]
            
            vendor_name = structured.get("vendor_name")
            vendor_gstin = structured.get("vendor_gstin")
            bill_number = structured.get("bill_number")
            bill_date = structured.get("bill_date")
            total_amount = structured.get("total_amount")
            subtotal = structured.get("subtotal")  # Taxable value
            cgst_amount = structured.get("cgst_amount")
            sgst_amount = structured.get("sgst_amount")
            igst_amount = structured.get("igst_amount")
            gst_amount = (cgst_amount or 0) + (sgst_amount or 0) + (igst_amount or 0)
            items = structured.get("items")
            confidence = structured.get("confidence")
            items_json = json.dumps(items) if items is not None else None

            # Extract amount from OCR text (basic regex for Indian currency patterns)
            detected_amount = None
            # Match patterns like ₹1,234.56 or Rs. 1234 or 1,234.00 or just numbers
            amount_patterns = [
                r"(?:₹|Rs\.?|INR)\s*([\d,]+\.?\d*)",  # ₹1,234 or Rs. 1234
                r"Total[:\s]*([\d,]+\.?\d*)",          # Total: 1234
                r"Amount[:\s]*([\d,]+\.?\d*)",         # Amount: 1234
                r"Grand\s*Total[:\s]*([\d,]+\.?\d*)",  # Grand Total: 1234
                r"\b([\d,]+\.\d{2})\b",                # Generic decimal like 1234.00
            ]
            for pattern in amount_patterns:
                match = re.search(pattern, ocr_text, re.IGNORECASE)
                if match:
                    amount_str = match.group(1).replace(",", "")
                    try:
                        detected_amount = float(amount_str)
                        break
                    except ValueError:
                        continue

            # Update bill record with OCR results
            with get_conn() as conn:
                conn.execute(
                    """UPDATE bills SET ocr_text = ?, detected_amount = ?, vendor_name = ?, bill_date = ?,
                           total_amount = ?, gst_amount = ?, items_json = ?, status = 'done'
                       WHERE id = ?""",
                    (ocr_text, detected_amount, vendor_name, bill_date, total_amount, gst_amount, items_json, bill_id),
                )

            # Auto-create ledger entry if we have a valid total amount
            if total_amount and total_amount > 0:
                with get_conn() as conn:
                    note = f"Bill from {vendor_name or 'Unknown Vendor'}"
                    exec_one(
                        conn,
                        """INSERT INTO entries (
                            user_id, entry_type, amount, note, source,
                            vendor_name, vendor_gstin, bill_number, bill_date,
                            taxable_amount, cgst_amount, sgst_amount, igst_amount
                        ) VALUES (?, 'expense', ?, ?, 'bill_upload', ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            user_id, total_amount, note,
                            vendor_name, vendor_gstin, bill_number, bill_date,
                            subtotal, cgst_amount, sgst_amount, igst_amount
                        )
                    )

            return jsonify({
                "ok": True,
                "bill": {
                    "id": bill_id,
                    "filename": original_filename,
                    "s3_url": public_url,
                    "ocr_text": ocr_text,
                    "detected_amount": detected_amount,
                    "vendor_name": vendor_name,
                    "bill_date": bill_date,
                    "total_amount": total_amount,
                    "gst_amount": gst_amount,
                    "items": items,
                    "confidence": confidence,
                    "status": "done",
                }
            })
        except Exception as e:
            # Log full error for debugging
            import traceback
            print("[ledgerly] upload_failed:", e)
            traceback.print_exc()
            return jsonify({"error": "upload_failed", "message": str(e)}), 500

    @app.get("/api/bills")
    def api_list_bills():
        """List all bills for the current user."""
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        with get_conn() as conn:
            rows = query_all(
                conn,
                """SELECT id, filename, s3_url, ocr_text, detected_amount, vendor_name, bill_date,
                          total_amount, gst_amount, items_json, status, created_at
                   FROM bills WHERE user_id = ? ORDER BY id DESC""",
                (user_id,),
            )

        return jsonify({"ok": True, "bills": [dict(r) for r in rows]})

    @app.get("/api/bills/<int:bill_id>")
    def api_get_bill(bill_id: int):
        """Get a specific bill by ID."""
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        with get_conn() as conn:
            row = query_one(
                conn,
                """SELECT id, filename, s3_url, ocr_text, detected_amount, vendor_name, bill_date,
                          total_amount, gst_amount, items_json, status, created_at
                   FROM bills WHERE id = ? AND user_id = ?""",
                (bill_id, user_id),
            )

        if row is None:
            return jsonify({"error": "not_found"}), 404

        return jsonify({"ok": True, "bill": dict(row)})

    # -------------------------
    # Insights / BI Query API
    # -------------------------
    INSIGHTS_SYSTEM_PROMPT = """You are a BI query generator for Ledgerly, a ledger/accounting system for small Indian businesses.

DATABASE SCHEMA:
- entries(id, user_id, entry_type TEXT ['income','expense'], amount REAL, note TEXT, source TEXT ['manual','voice','bill_upload'], vendor_name TEXT, created_at TEXT)

USER QUERIES (Hindi/English/Hinglish mixed):
- "Kal ka galla" → yesterday's total income
- "Aaj kitna kamaya" → today's total income
- "Aaj kitna kharch" → today's total expenses
- "Cash me kitna" → requires payment_mode which doesn't exist, use total income
- "GST kitna laga" → total from bill_upload entries (as they have GST)
- "Total income" → sum of all income entries
- "Total expense" → sum of all expense entries
- "Last 7 din" → last 7 days data
- "Iss hafte" → this week's data
- "Iss mahine" → this month's data

OUTPUT FORMAT (JSON ONLY, NO MARKDOWN, NO CODE BLOCKS):
{"sql": "SELECT ...", "chart": "bar|pie|line|none", "title": "Human readable title", "value_format": "currency|number|percent"}

RULES:
1. Output ONLY valid JSON - no ```json blocks, no explanations, no markdown
2. Use SQLite date functions: date('now'), date('now', '-1 day'), date('now', '-7 days')
3. created_at is stored as 'YYYY-MM-DD HH:MM:SS' format
4. For date comparisons use: date(created_at) = date('now')
5. Chart types: "bar" for trends, "pie" for breakdowns, "line" for time series, "none" for single values
6. Always filter by user_id = {user_id} for security
7. For "kal" (yesterday): WHERE date(created_at) = date('now', '-1 day')
8. For "aaj" (today): WHERE date(created_at) = date('now')
9. For aggregations return: SELECT SUM(amount), entry_type FROM entries WHERE ... GROUP BY entry_type
10. For trends return: SELECT date(created_at) as day, SUM(amount) FROM entries WHERE ... GROUP BY day ORDER BY day
"""

    def parse_ai_response(raw: str) -> dict:
        """Aggressive JSON extraction from Gemini response."""
        clean = raw.strip()
        
        # Try direct parse first
        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            pass
        
        # Strip markdown code blocks
        if "```json" in clean:
            clean = clean.split("```json")[1]
        if "```" in clean:
            parts = clean.split("```")
            for part in parts:
                part = part.strip()
                if part.startswith("{"):
                    clean = part
                    break
            else:
                clean = parts[0].strip()
        
        # Remove leading "json" if present
        if clean.startswith("json"):
            clean = clean[4:].strip()
        
        # Try parsing again
        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            pass
        
        # Extract JSON object using regex
        match = re.search(r'\{[^{}]*\}', clean, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        
        raise ValueError(f"Could not parse AI response: {raw[:200]}")

    def validate_sql(sql: str, user_id: int) -> str:
        """Basic SQL validation to prevent injection and ensure user filtering."""
        sql_lower = sql.lower().strip()
        
        # Only allow SELECT statements
        if not sql_lower.startswith("select"):
            raise ValueError("Only SELECT queries are allowed")
        
        # Block dangerous keywords
        dangerous = ["drop", "delete", "update", "insert", "alter", "create", "truncate", ";"]
        for keyword in dangerous:
            if keyword in sql_lower:
                raise ValueError(f"Dangerous SQL keyword detected: {keyword}")
        
        # Ensure user_id filter is present
        if "user_id" not in sql_lower:
            # Add user_id filter
            if "where" in sql_lower:
                sql = sql.replace("WHERE", f"WHERE user_id = {user_id} AND", 1)
                sql = sql.replace("where", f"WHERE user_id = {user_id} AND", 1)
            else:
                # Find FROM clause and add WHERE
                sql = re.sub(r'(FROM\s+entries)', f'\\1 WHERE user_id = {user_id}', sql, flags=re.IGNORECASE)
        
        return sql

    @app.post("/api/insights/ask")
    def api_insights_ask():
        """Process natural language query and return insights from database."""
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        data = request.get_json(silent=True) or {}
        question = (data.get("question") or "").strip()

        if not question:
            return jsonify({"error": "question_required"}), 400

        try:
            # Use Gemini to convert question to SQL
            if not GEMINI_API_KEY:
                return jsonify({
                    "error": "gemini_not_configured",
                    "message": "Please set GEMINI_API_KEY in .env file for AI-powered insights"
                }), 400

            prompt = INSIGHTS_SYSTEM_PROMPT.replace("{user_id}", str(user_id)) + f"\n\nUser question: {question}"
            
            model = genai.GenerativeModel(GEMINI_MODEL or "gemini-2.0-flash")
            response = model.generate_content(prompt)
            raw_response = response.text or ""

            # Parse AI response
            ai_result = parse_ai_response(raw_response)
            sql = ai_result.get("sql", "")
            chart_type = ai_result.get("chart", "none")
            title = ai_result.get("title", "Query Result")
            value_format = ai_result.get("value_format", "currency")

            if not sql:
                return jsonify({"error": "no_sql_generated", "message": "Could not generate SQL from question"}), 400

            # Validate and sanitize SQL
            sql = validate_sql(sql, user_id)

            # Execute query
            with get_conn() as conn:
                rows = conn.execute(sql).fetchall()
                columns = [desc[0] for desc in conn.execute(sql).description] if rows else []

            # Format response based on chart type
            if chart_type == "none" or len(rows) == 1:
                # Single value result
                value = rows[0][0] if rows and rows[0][0] is not None else 0
                return jsonify({
                    "ok": True,
                    "title": title,
                    "value": value,
                    "value_format": value_format,
                    "chart": "none",
                    "data": None,
                    "sql": sql  # For debugging
                })
            else:
                # Chart data result
                data_points = []
                for row in rows:
                    if len(row) >= 2:
                        data_points.append({
                            "label": str(row[0]) if row[0] else "Unknown",
                            "value": float(row[1]) if row[1] else 0
                        })
                    elif len(row) == 1:
                        data_points.append({
                            "label": "Total",
                            "value": float(row[0]) if row[0] else 0
                        })

                total_value = sum(dp["value"] for dp in data_points)

                return jsonify({
                    "ok": True,
                    "title": title,
                    "value": total_value,
                    "value_format": value_format,
                    "chart": chart_type,
                    "data": data_points,
                    "sql": sql  # For debugging
                })

        except ValueError as e:
            return jsonify({"error": "validation_failed", "message": str(e)}), 400
        except Exception as e:
            print(f"[ledgerly] Insights query error: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({"error": "query_failed", "message": str(e)}), 500

    @app.get("/api/insights/summary")
    def api_insights_summary():
        """Get summary statistics for insights dashboard."""
        user_id = require_login()
        if not user_id:
            return jsonify({"error": "unauthorized"}), 401

        try:
            with get_conn() as conn:
                # Total income (all time)
                total_income = query_one(conn, 
                    "SELECT COALESCE(SUM(amount), 0) FROM entries WHERE user_id = ? AND entry_type = 'income'",
                    (user_id,)
                )[0]

                # Total expenses (all time)
                total_expenses = query_one(conn,
                    "SELECT COALESCE(SUM(amount), 0) FROM entries WHERE user_id = ? AND entry_type = 'expense'",
                    (user_id,)
                )[0]

                # This week income
                week_income = query_one(conn,
                    """SELECT COALESCE(SUM(amount), 0) FROM entries 
                       WHERE user_id = ? AND entry_type = 'income' 
                       AND date(created_at) >= date('now', '-7 days')""",
                    (user_id,)
                )[0]

                # This week expenses
                week_expenses = query_one(conn,
                    """SELECT COALESCE(SUM(amount), 0) FROM entries 
                       WHERE user_id = ? AND entry_type = 'expense' 
                       AND date(created_at) >= date('now', '-7 days')""",
                    (user_id,)
                )[0]

                # Today's income
                today_income = query_one(conn,
                    """SELECT COALESCE(SUM(amount), 0) FROM entries 
                       WHERE user_id = ? AND entry_type = 'income' 
                       AND date(created_at) = date('now')""",
                    (user_id,)
                )[0]

                # Today's expenses
                today_expenses = query_one(conn,
                    """SELECT COALESCE(SUM(amount), 0) FROM entries 
                       WHERE user_id = ? AND entry_type = 'expense' 
                       AND date(created_at) = date('now')""",
                    (user_id,)
                )[0]

                # Entry count by source
                source_counts = query_all(conn,
                    """SELECT COALESCE(source, 'manual') as src, COUNT(*) as cnt 
                       FROM entries WHERE user_id = ? GROUP BY src""",
                    (user_id,)
                )

                # Last 7 days trend
                daily_trend = query_all(conn,
                    """SELECT date(created_at) as day, 
                              SUM(CASE WHEN entry_type = 'income' THEN amount ELSE 0 END) as income,
                              SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END) as expense
                       FROM entries WHERE user_id = ? AND date(created_at) >= date('now', '-7 days')
                       GROUP BY day ORDER BY day""",
                    (user_id,)
                )

            net_cash = total_income - total_expenses
            week_net = week_income - week_expenses

            return jsonify({
                "ok": True,
                "summary": {
                    "total_income": total_income,
                    "total_expenses": total_expenses,
                    "net_cash": net_cash,
                    "week_income": week_income,
                    "week_expenses": week_expenses,
                    "week_net": week_net,
                    "today_income": today_income,
                    "today_expenses": today_expenses,
                    "source_breakdown": [{"source": r[0], "count": r[1]} for r in source_counts],
                    "daily_trend": [{"day": r[0], "income": r[1], "expense": r[2]} for r in daily_trend]
                }
            })

        except Exception as e:
            print(f"[ledgerly] Insights summary error: {e}")
            return jsonify({"error": "summary_failed", "message": str(e)}), 500

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=False)
