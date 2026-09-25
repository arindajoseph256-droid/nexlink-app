/* ==========================================================================
   NEXLINK — theme.js
   Dark/light theme toggle. Preference persists in localStorage; the
   no-flash snippet in base.html applies it before first paint.
   ========================================================================== */

(function () {
    'use strict';

    var STORAGE_KEY = 'nexlink-theme';

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        var toggle = document.getElementById('theme-toggle');
        if (toggle) {
            toggle.setAttribute('aria-pressed', String(theme === 'dark'));
            var label = toggle.querySelector('.theme-toggle__label');
            if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';
        }
    }

    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark'
            ? 'dark' : 'light';
    }

    function toggle() {
        var next = currentTheme() === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch (err) {
            /* private mode: preference just won't persist */
        }
        applyTheme(next);
    }

    document.addEventListener('DOMContentLoaded', function () {
        var toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggle);
            // Sync button state with whatever the no-flash script applied.
            applyTheme(currentTheme());
        }
    });
})();
