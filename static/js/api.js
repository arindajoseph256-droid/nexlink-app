/* ==========================================================================
   NEXLINK — api.js
   Thin fetch wrapper handling CSRF tokens and JSON.
   ========================================================================== */

window.PulseAPI = (function () {
    'use strict';

    function getCookie(name) {
        var value = '; ' + document.cookie;
        var parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function csrfToken() {
        return getCookie('csrftoken');
    }

    function request(method, url, body) {
        var options = {
            method: method,
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrfToken(),
                'Accept': 'application/json',
            },
            credentials: 'same-origin',
        };
        if (body instanceof FormData) {
            options.body = body;
            delete options.headers['Content-Type'];
        } else if (body !== undefined) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        return fetch(url, options).then(function (response) {
            if (response.status === 204) return null;
            return response.json().then(
                function (data) {
                    if (!response.ok) {
                        var detail = data && (data.detail || JSON.stringify(data));
                        throw new Error(detail || ('HTTP ' + response.status));
                    }
                    return data;
                },
                function () {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return null;
                }
            );
        });
    }

    return {
        get: function (url) { return request('GET', url); },
        post: function (url, body) { return request('POST', url, body || {}); },
        patch: function (url, body) { return request('PATCH', url, body); },
        delete: function (url) { return request('DELETE', url); },
        csrfToken: csrfToken,
    };
})();
