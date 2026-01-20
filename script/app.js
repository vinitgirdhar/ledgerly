document.addEventListener('DOMContentLoaded', () => {
    const scrollToTopButton = document.querySelector('.scroll-to-top');

    // Auth link toggle (served by Flask backend)
    (async () => {
        const authLink = document.getElementById('authLink');
        if (!authLink) return;

        try {
            const res = await fetch('/api/me', { credentials: 'same-origin' });
            const data = await res.json();
            if (data && data.user) {
                authLink.textContent = 'Sign out';
                authLink.href = '#';
                authLink.addEventListener('click', async (e) => {
                    e.preventDefault();
                    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
                    window.location.reload();
                });
            } else {
                authLink.textContent = 'Sign in';
                authLink.href = 'login.html';
            }
        } catch {
            // If backend isn't running, keep default link.
        }
    })();

    window.addEventListener('scroll', () => {
        if (window.scrollY > 400) {
            scrollToTopButton.classList.add('visible');
        } else {
            scrollToTopButton.classList.remove('visible');
        }
    }, { passive: true });

    scrollToTopButton.addEventListener('click', e => {
        e.preventDefault();
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    gsap.registerPlugin(ScrollTrigger);

    initMouseRing();
    initHeroParallax();
    initScrollingDetails();
    initToasts();
    initContactForm();
    wireToastTriggers();

    const animationContainer = document.getElementById('animation');
    if (animationContainer) {
        createAnimationElements(animationContainer);
    }

    gsap.from('.hero-content h1', { duration: 1, y: 50, opacity: 0, ease: 'power3.out' });
    gsap.from('.hero-content .subtitle', { duration: 1, y: 50, opacity: 0, ease: 'power3.out', delay: 0.2 });
    gsap.from('.cta-buttons', { duration: 1, y: 50, opacity: 0, ease: 'power3.out', delay: 0.4 });
    gsap.from('.hero-visual', { duration: 1, scale: 0.9, opacity: 0, ease: 'power3.out', delay: 0.6 });

    const sections = gsap.utils.toArray('section');
    sections.forEach(section => {
        gsap.from(section, {
            scrollTrigger: {
                trigger: section,
                start: 'top 80%',
                end: 'bottom 20%',
                toggleActions: 'play none none none'
            },
            opacity: 0,
            y: 50,
            duration: 1,
            ease: 'power3.out'
        });
    });

    const cards = gsap.utils.toArray('.feature-card, .how-step, .metric-card, .pricing-card, .testimonial-card, .about-stat');
    cards.forEach(card => {
        gsap.from(card, {
            scrollTrigger: {
                trigger: card,
                start: 'top 85%',
                end: 'bottom 15%',
                toggleActions: 'play none none none'
            },
            opacity: 0,
            y: 40,
            duration: 0.8,
            ease: 'power3.out'
        });
    });
});

function initMouseRing() {
    if (!window.matchMedia('(pointer:fine)').matches) {
        return;
    }

    const ring = document.createElement('div');
    ring.className = 'mouse-ring';
    document.body.appendChild(ring);

    // Using gsap.to with very short duration for smoother lag effect, or quickSetter for instant
    // To fix "slowness", we want to reduce the lag or make it tighter.
    // Let's use gsap.ticker to update position for better performance loop,
    // or just use direct style transform if we want 1:1 speed.
    
    // APPROACH: Use a simple direct transform for immediate feel, 
    // or a very fast spring. Current implementation uses quickSetter which is good, 
    // but maybe the CSS transition on the class is interfering?
    // Let's check styles.css later. For now, let's optimize the JS update loop.

    let mouseX = 0;
    let mouseY = 0;
    let ringX = 0;
    let ringY = 0;

    // Listen for mouse updates
    window.addEventListener('pointermove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    // Use GSAP ticker for smooth 60fps updates rather than pure event listener
    gsap.ticker.add(() => {
        // Linear interpolation for a "smooth follow" feeling that isn't too lazy
        // Increase 0.15 to something higher (e.g. 0.3) for snappier response, 
        // or 1.0 for instant lock.
        const dt = 1.0 - Math.pow(1.0 - 0.35, gsap.ticker.deltaRatio()); 
        
        ringX += (mouseX - ringX) * dt;
        ringY += (mouseY - ringY) * dt;
        
        gsap.set(ring, { x: ringX, y: ringY });
    });
    
    window.addEventListener('pointerdown', () => ring.classList.add('is-active'));
    window.addEventListener('pointerup', () => ring.classList.remove('is-active'));

    const interactiveSelectors = 'a, button, .feature-card, .pricing-card, .how-step, .metric-card, .testimonial-card, .about-stat, .hero-card';
    document.querySelectorAll(interactiveSelectors).forEach((el) => {
        el.addEventListener('pointerenter', () => ring.classList.add('is-active'));
        el.addEventListener('pointerleave', () => ring.classList.remove('is-active'));
    });
}

function initHeroParallax() {
    const hero = document.querySelector('.hero');
    const heroVisual = document.querySelector('.hero-visual');
    if (!hero || !heroVisual || !window.matchMedia('(pointer:fine)').matches) {
        return;
    }

    const heroCard = heroVisual.querySelector('.hero-card');
    const floatingChips = heroVisual.querySelectorAll('[data-floating]');

    const handleMove = (event) => {
        const rect = hero.getBoundingClientRect();
        const relX = (event.clientX - rect.left) / rect.width - 0.5;
        const relY = (event.clientY - rect.top) / rect.height - 0.5;

        gsap.to(heroVisual, {
            x: relX * 30,
            y: relY * 20,
            duration: 0.6,
            ease: 'power2.out'
        });

        if (heroCard) {
            gsap.to(heroCard, {
                x: relX * -20,
                y: relY * -15,
                rotation: relX * 6,
                duration: 0.6,
                ease: 'power2.out'
            });
        }

        floatingChips.forEach((chip, index) => {
            gsap.to(chip, {
                x: relX * (12 + index * 4),
                y: relY * (14 + index * 3),
                rotation: relX * 10,
                duration: 0.6,
                ease: 'power2.out'
            });
        });
    };

    const reset = () => {
        gsap.to([heroVisual, heroCard], {
            x: 0,
            y: 0,
            rotation: 0,
            duration: 0.8,
            ease: 'power3.out'
        });
    };

    hero.addEventListener('pointermove', handleMove);
    hero.addEventListener('pointerleave', reset);

    floatingChips.forEach((chip, index) => {
        const floatDistance = 8 + index * 4;
        gsap.to(chip, {
            y: `+=${floatDistance}`,
            x: `+=${floatDistance / 2}`,
            duration: 3 + index,
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut'
        });
    });
}

function initScrollingDetails() {
    const marquee = document.querySelector('.marquee-track');
    if (marquee) {
        gsap.to(marquee, {
            xPercent: -50,
            repeat: -1,
            duration: 20,
            ease: 'linear'
        });
    }

    const metricCards = document.querySelectorAll('.metric-card');
    metricCards.forEach((card, index) => {
        const stats = card.querySelector('h3');
        if (!stats) return;

        const targetValue = stats.textContent.trim();
        const numericMatch = targetValue.match(/[\d\.]+/);
        if (!numericMatch) return;

        const endValue = parseFloat(numericMatch[0]);
        const suffix = targetValue.replace(/[\d\.]/g, '');

        const obj = { val: 0 };
        gsap.to(obj, {
            val: endValue,
            scrollTrigger: {
                trigger: card,
                start: 'top 80%'
            },
            duration: 1.4 + index * 0.1,
            ease: 'power2.out',
            onUpdate: () => {
                stats.textContent = `${Math.round(obj.val)}${suffix}`;
            }
        });
    });

    const scrollIndicator = document.querySelector('.scroll-indicator');
    if (scrollIndicator) {
        scrollIndicator.addEventListener('pointerenter', () => scrollIndicator.classList.add('is-hovered'));
        scrollIndicator.addEventListener('pointerleave', () => scrollIndicator.classList.remove('is-hovered'));
    }
}

let toastStack = null;

function initToasts() {
    toastStack = document.getElementById('toastStack');
    if (!toastStack) return;
    toastStack.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-dismiss="toast"]');
        if (!btn) return;
        const toastEl = btn.closest('.toast');
        if (toastEl) {
            dismissToast(toastEl);
        }
    });
}

function showToast(message, intent = 'info', title) {
    if (!toastStack) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.intent = intent;

    if (title) {
        const heading = document.createElement('h4');
        heading.textContent = title;
        toast.appendChild(heading);
    }

    const body = document.createElement('p');
    body.textContent = message;
    toast.appendChild(body);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.dataset.dismiss = 'toast';
    closeBtn.textContent = 'Close';
    toast.appendChild(closeBtn);

    toastStack.appendChild(toast);

    const hide = () => dismissToast(toast);
    const timer = setTimeout(hide, 4000);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => {
        setTimeout(hide, 2000);
    }, { once: true });
}

function dismissToast(el) {
    el.style.animation = 'toast-out 0.2s ease forwards';
    el.addEventListener('animationend', () => {
        el.remove();
    }, { once: true });
}

function wireToastTriggers() {
    if (!toastStack) return;
    const triggers = document.querySelectorAll('[data-toast]');
    triggers.forEach((trigger) => {
        trigger.addEventListener('click', (event) => {
            const message = trigger.getAttribute('data-toast');
            if (!message) return;
            const intent = trigger.getAttribute('data-intent') || 'info';
            const title = trigger.getAttribute('data-toast-title') || null;
            showToast(message, intent, title);

            if (trigger.tagName === 'A') {
                const href = trigger.getAttribute('href') || '';
                if (href === '#') {
                    event.preventDefault();
                }
            } else if (trigger.tagName === 'BUTTON' && trigger.type === 'button') {
                event.preventDefault();
            }
        });
    });
}

function initContactForm() {
    const form = document.querySelector('.contact-form');
    if (!form) return;
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const message = form.querySelector('[data-toast]')?.getAttribute('data-toast')
            || 'Message received! We will reach out shortly.';
        const intent = form.querySelector('[data-toast]')?.getAttribute('data-intent') || 'success';
        showToast(message, intent);
        form.reset();
    });
}

function createAnimationElements(animationContainer) {
    // Create circles
    for (let i = 0; i < 5; i++) {
        const circle = document.createElement('div');
        circle.className = 'circle';
        circle.style.width = `${Math.random() * 100 + 50}px`;
        circle.style.height = circle.style.width;
        circle.style.left = `${Math.random() * 80 + 10}%`;
        circle.style.top = `${Math.random() * 80 + 10}%`;
        circle.style.opacity = Math.random() * 0.3 + 0.1;
        circle.style.background = 'rgba(35, 76, 88, 0.18)';
        animationContainer.appendChild(circle);
        
        gsap.to(circle, {
            x: (Math.random() - 0.5) * 40,
            y: (Math.random() - 0.5) * 40,
            duration: Math.random() * 3 + 2,
            repeat: -1,
            yoyo: true,
            ease: 'sine.inOut'
        });
    }

    // Create dollar signs
    for (let i = 0; i < 10; i++) {
        const dollar = document.createElement('div');
        dollar.className = 'dollar';
        dollar.textContent = '₹';
        dollar.style.left = `${Math.random() * 90 + 5}%`;
        dollar.style.top = `${Math.random() * 90 + 5}%`;
        dollar.style.opacity = 0;
        animationContainer.appendChild(dollar);
        
        gsap.to(dollar, {
            opacity: 0.8,
            y: -40,
            duration: 3,
            delay: i * 0.3,
            repeat: -1,
            repeatDelay: 5,
            ease: 'power1.out',
            onComplete: () => {
                gsap.to(dollar, {
                    opacity: 0,
                    duration: 1,
                    delay: 1,
                    ease: 'power1.in'
                });
            }
        });
    }

    // Create graph line
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    animationContainer.appendChild(svg);

    const points = [];
    const numPoints = 50;
    const width = animationContainer.offsetWidth;
    const height = animationContainer.offsetHeight;
    
    for (let i = 0; i <= numPoints; i++) {
        const x = (i / numPoints) * width;
        const y = height / 2 + Math.sin(i * 0.2) * 40 - 20;
        points.push([x, y]);
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let d = `M ${points[0][0]},${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
        d += ` L ${points[i][0]},${points[i][1]}`;
    }
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#234C58");
    path.setAttribute("stroke-width", "3");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-dasharray", "1000");
    path.setAttribute("stroke-dashoffset", "1000");
    svg.appendChild(path);

    gsap.to(path, {
        strokeDashoffset: 0,
        duration: 3,
        ease: "power2.inOut"
    });
}
