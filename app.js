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
    });

    scrollToTopButton.addEventListener('click', e => {
        e.preventDefault();
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
    gsap.registerPlugin(ScrollTrigger);

    // Hero Animation
    const animationContainer = document.getElementById('animation');
    if (animationContainer) {
        createAnimationElements(animationContainer);
    }

    gsap.from('.hero-content h1', { duration: 1, y: 50, opacity: 0, ease: 'power3.out' });
    gsap.from('.hero-content .subtitle', { duration: 1, y: 50, opacity: 0, ease: 'power3.out', delay: 0.2 });
    gsap.from('.cta-buttons', { duration: 1, y: 50, opacity: 0, ease: 'power3.out', delay: 0.4 });
    gsap.from('.hero-visual', { duration: 1, scale: 0.9, opacity: 0, ease: 'power3.out', delay: 0.6 });

    // Section Animations
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

    // Card Animations
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
