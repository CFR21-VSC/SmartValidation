/* ====================================================================
   SIGNATURE CANVAS - controller reutilizable para garabateo de firma.
   Funciona con mouse y touch (celular). Devuelve dataUrl PNG.

   Uso:
     const sc = SignatureCanvas.attach(canvasElement, { onChange });
     sc.clear();
     sc.toDataURL();           -> "data:image/png;base64,..."
     sc.isEmpty();             -> bool
     sc.detach();              -> remueve listeners
   ==================================================================== */

(function (global) {
    'use strict';

    const SignatureCanvas = {};

    function attach(canvas, opts) {
        opts = opts || {};
        if (!canvas || canvas.tagName !== 'CANVAS') {
            throw new Error('SignatureCanvas.attach requiere un elemento <canvas>');
        }

        // ── Setup HiDPI ──
        function resizeCanvas() {
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            // Solo redimensionar si cambia (preserva el trazado entre resizes raros)
            const targetW = Math.floor(rect.width * dpr);
            const targetH = Math.floor(rect.height * dpr);
            if (canvas.width !== targetW || canvas.height !== targetH) {
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                applyDefaultStyle(ctx);
            }
        }

        function applyDefaultStyle(ctx) {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = opts.color || '#1F3C56';
            ctx.lineWidth = opts.lineWidth || 2.5;
        }

        const ctx = canvas.getContext('2d');
        applyDefaultStyle(ctx);
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // ── Drawing state ──
        let drawing = false;
        let lastX = 0, lastY = 0;
        let hasContent = false;

        function getEventPos(e) {
            const rect = canvas.getBoundingClientRect();
            let clientX, clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX;
                clientY = e.changedTouches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        }

        function startDraw(e) {
            e.preventDefault();
            drawing = true;
            const p = getEventPos(e);
            lastX = p.x; lastY = p.y;
            // Punto inicial (para que click sin arrastrar deje marca)
            ctx.beginPath();
            ctx.arc(lastX, lastY, (opts.lineWidth || 2.5) / 2, 0, Math.PI * 2);
            ctx.fillStyle = opts.color || '#1F3C56';
            ctx.fill();
            hasContent = true;
        }

        function moveDraw(e) {
            if (!drawing) return;
            e.preventDefault();
            const p = getEventPos(e);
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            lastX = p.x; lastY = p.y;
            hasContent = true;
            if (typeof opts.onChange === 'function') opts.onChange();
        }

        function endDraw(e) {
            if (!drawing) return;
            if (e && e.preventDefault) e.preventDefault();
            drawing = false;
            if (typeof opts.onChange === 'function') opts.onChange();
        }

        // Mouse
        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', moveDraw);
        canvas.addEventListener('mouseup', endDraw);
        canvas.addEventListener('mouseleave', endDraw);
        // Touch
        canvas.addEventListener('touchstart', startDraw, { passive: false });
        canvas.addEventListener('touchmove', moveDraw, { passive: false });
        canvas.addEventListener('touchend', endDraw, { passive: false });
        canvas.addEventListener('touchcancel', endDraw, { passive: false });

        function clearCanvas() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            applyDefaultStyle(ctx);
            hasContent = false;
            if (typeof opts.onChange === 'function') opts.onChange();
        }

        function isEmpty() {
            return !hasContent;
        }

        function toDataURL() {
            // Devolver PNG con fondo transparente para que el renderer
            // del libro pueda meterlo sobre cualquier color.
            return canvas.toDataURL('image/png');
        }

        function detach() {
            canvas.removeEventListener('mousedown', startDraw);
            canvas.removeEventListener('mousemove', moveDraw);
            canvas.removeEventListener('mouseup', endDraw);
            canvas.removeEventListener('mouseleave', endDraw);
            canvas.removeEventListener('touchstart', startDraw);
            canvas.removeEventListener('touchmove', moveDraw);
            canvas.removeEventListener('touchend', endDraw);
            canvas.removeEventListener('touchcancel', endDraw);
            window.removeEventListener('resize', resizeCanvas);
        }

        function loadDataURL(dataUrl) {
            return new Promise((resolve, reject) => {
                if (!dataUrl) { clearCanvas(); resolve(); return; }
                const img = new Image();
                img.onload = () => {
                    clearCanvas();
                    const rect = canvas.getBoundingClientRect();
                    ctx.drawImage(img, 0, 0, rect.width, rect.height);
                    hasContent = true;
                    if (typeof opts.onChange === 'function') opts.onChange();
                    resolve();
                };
                img.onerror = reject;
                img.src = dataUrl;
            });
        }

        return {
            clear: clearCanvas,
            isEmpty,
            toDataURL,
            detach,
            loadDataURL,
            resize: resizeCanvas
        };
    }

    SignatureCanvas.attach = attach;
    global.SignatureCanvas = SignatureCanvas;

})(window);
