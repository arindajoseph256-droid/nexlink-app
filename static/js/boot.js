(function () {
    'use strict';

    var screen = document.getElementById('boot-screen');
    if (!screen) return;

    var startedAt = Date.now();
    var minimumVisibleMs = 1200;

    function dismiss() {
        var remaining = Math.max(0, minimumVisibleMs - (Date.now() - startedAt));
        setTimeout(function () {
            screen.classList.add('is-leaving');
            document.body.classList.add('app-ready');
            setTimeout(function () {
                screen.remove();
            }, 420);
        }, remaining);
    }

    if (document.readyState === 'complete') {
        dismiss();
    } else {
        window.addEventListener('load', dismiss, { once: true });
    }

    setTimeout(dismiss, 3200);
})();