/* ==========================================================================
   NEXLINK — auth.js
   Small progressive enhancements for auth pages. Works without JS too.
   ========================================================================== */

(function () {
    'use strict';

    /* ---------- Show / hide password ---------- */

    document.querySelectorAll('[data-toggle-password]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var input = document.getElementById(btn.getAttribute('data-toggle-password'));
            if (!input) return;
            var show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.setAttribute('aria-pressed', String(show));
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            btn.querySelector('.password-toggle__icon').textContent = show ? '🙈' : '👁';
            input.focus();
        });
    });

    /* ---------- Password strength meter (register page) ---------- */

    var meterBar = document.querySelector('[data-meter-bar]');
    var passwordInput = document.getElementById('id_password1');

    if (meterBar && passwordInput) {
        passwordInput.addEventListener('input', function () {
            var score = scorePassword(passwordInput.value);
            meterBar.setAttribute('data-strength', String(score));
        });
    }

    function scorePassword(value) {
        if (!value) return 0;
        var score = 0;
        if (value.length >= 8) score++;
        if (value.length >= 12) score++;
        if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
        if (/\d/.test(value)) score++;
        if (/[^A-Za-z0-9]/.test(value)) score++;
        return Math.min(score, 4);
    }

    /* ---------- Submit loading state ---------- */

    document.querySelectorAll('form.auth-form').forEach(function (form) {
        form.addEventListener('submit', function () {
            if (form.checkValidity()) {
                var btn = form.querySelector('button[type="submit"]');
                if (btn) {
                    btn.classList.add('is-loading');
                    var label = btn.getAttribute('data-loading-label');
                    var labelEl = btn.querySelector('.btn__label');
                    if (label && labelEl) labelEl.textContent = label;
                }
            }
        });
    });
})();
