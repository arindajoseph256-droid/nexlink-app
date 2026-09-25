/* ==========================================================================
   NEXLINK — profile.js
   Settings page enhancement: instant avatar preview when a new picture
   is chosen (client-side only; server still validates the upload).
   ========================================================================== */

(function () {
    'use strict';

    var fileInput = document.getElementById('id_picture');
    if (!fileInput) return;

    fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file || !window.FileReader) return;
        if (file.type.indexOf('image/') !== 0) return;

        var reader = new FileReader();
        reader.onload = function (event) {
            var current = document.querySelector('.settings-form__current .avatar');
            if (current) {
                current.textContent = '';
                var img = document.createElement('img');
                img.src = event.target.result;
                img.alt = 'New avatar preview';
                current.appendChild(img);
            }
        };
        reader.readAsDataURL(file);
    });
})();
