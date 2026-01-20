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
import google.generativeai as genai
import cv2
import numpy as np

from db import connect, default_db_path, init_db, query_one, query_all, exec_one

# Configure Tesseract path (Windows default install location)
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# Gemini Vision API key (optional)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Allowed file extensions for bill uploads
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"}

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
        return None

    try:
        # Preprocess image for better accuracy
        processed_path = preprocess_bill_image(image_path)
        
        # Load image for Gemini
        pil_image = Image.open(processed_path)
        
        # STEP 3: First extraction pass
        extraction_prompt = EXTRACTION_PROMPT.format(ocr_text=ocr_text)
        model = genai.GenerativeModel("gemini-2.0-flash-exp")
        
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
                "SELECT id, entry_type, amount, note, created_at FROM entries WHERE user_id = ? ORDER BY id DESC",
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
            return jsonify({"error": "invalid_file_type", "message": "Only image files (PNG, JPG, etc.) are allowed."}), 400

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

            # Run Tesseract OCR on local file
            image = Image.open(local_path)
            ocr_text = pytesseract.image_to_string(image)

            # Use Gemini Vision to structure data (optional)
            structured = run_gemini_structured(local_path, ocr_text) or {}
            
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
                            user_id, entry_type, amount, note, 
                            vendor_name, vendor_gstin, bill_number, bill_date,
                            taxable_amount, cgst_amount, sgst_amount, igst_amount
                        ) VALUES (?, 'expense', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
    # Voice Entry API
    # -------------------------
    VOICE_EXTRACTION_PROMPT = """
You are a financial data extraction AI for Indian shop owners.

Given a voice transcript in Hinglish, Hindi, Marathi, or English, extract structured transaction information.

Transcript: "{transcript}"

Extract and return ONLY valid JSON in this format:
{{
  "entry_type": "income" or "expense",
  "amount": <numeric amount>,
  "items": [
    {{
      "name": "item name",
      "quantity": <number>,
      "unit": "kg/pcs/packet/etc",
      "price": <price per unit or total>
    }}
  ],
  "note": "brief description",
  "customer_name": "name if mentioned" or null,
  "vendor_name": "name if mentioned" or null
}}

Rules:
- "becha" (sold), "liya" (bought), "khareed" (purchased) = income/expense indicators
- Extract amounts in rupees (₹, rupaye, rupees)
- Extract quantities (kilo, kg, pcs, pieces)
- If entry_type unclear, default to "income" for sales
- Return ONLY the JSON, no markdown or explanations.
"""

    def extract_voice_data_simple(transcript: str) -> dict:
        """Fallback simple extraction using regex when Gemini is unavailable."""
        import re
        
        transcript_lower = transcript.lower()
        
        # Determine entry type
        entry_type = "income"  # default
        if any(word in transcript_lower for word in ["khareed", "liya", "purchase", "bought", "expense"]):
            entry_type = "expense"
        elif any(word in transcript_lower for word in ["becha", "sold", "sale", "income"]):
            entry_type = "income"
        
        # Extract amount (look for numbers with rupee indicators)
        amount = None
        amount_patterns = [
            r"(?:₹|rupee|rupaye|rs\.?)\s*([\d,]+\.?\d*)",
            r"([\d,]+\.?\d*)\s*(?:rupee|rupaye|rs\.?)",
            r"([\d,]+\.?\d*)",
        ]
        for pattern in amount_patterns:
            match = re.search(pattern, transcript_lower)
            if match:
                try:
                    amount_str = match.group(1).replace(",", "")
                    amount = float(amount_str)
                    break
                except (ValueError, IndexError):
                    continue
        
        # Extract quantity and item name
        items = []
        quantity = None
        unit = None
        item_name = None
        
        # Pattern: "5 kilo chawal" or "10 kg rice"
        item_pattern = r"([\d,]+\.?\d*)\s*(kilo|kg|pcs|pieces|packet|box)\s+(\w+)"
        item_match = re.search(item_pattern, transcript_lower)
        if item_match:
            try:
                quantity = float(item_match.group(1).replace(",", ""))
                unit = item_match.group(2)
                item_name = item_match.group(3)
            except (ValueError, IndexError):
                pass
        
        if item_name and quantity:
            items.append({
                "name": item_name,
                "quantity": quantity,
                "unit": unit or "pcs",
                "price": amount / quantity if amount and quantity else None
            })
        
        note = transcript.strip()
        
        return {
            "entry_type": entry_type,
            "amount": amount or 0,
            "items": items,
            "note": note,
            "customer_name": None,
            "vendor_name": None
        }

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
                    model = genai.GenerativeModel("gemini-2.0-flash-exp")
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
                    "INSERT INTO entries (user_id, entry_type, amount, note) VALUES (?,?,?,?)",
                    (user_id, entry_type, float(amount), note),
                )

                # Fetch the created entry
                row = query_one(
                    conn,
                    "SELECT id, entry_type, amount, note, created_at FROM entries WHERE id = ?",
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

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=True)
