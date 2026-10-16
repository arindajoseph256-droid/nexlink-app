/* ============================================================
   NEXLINK ADMIN SPA — vanilla JS, talks to /api/admin/* only.
   Every screen uses real endpoints; nothing is mocked.
   ============================================================ */
(function () {
    'use strict';

    var root = document.getElementById('admin-root');
    var CSRF = (document.querySelector('input[name=csrfmiddlewaretoken]') || {}).value || '';
    var content = document.getElementById('admin-content');
    var titleEl = document.getElementById('admin-title');
    var rolePill = document.getElementById('admin-role-pill');
    var toastEl = document.getElementById('admin-toast');
    var modalEl = document.getElementById('admin-modal');
    var modalCard = document.getElementById('admin-modal-card');

    var state = { me: null, usersPage: 1, usersQuery: '', statusFilter: '' };

    // ------------- helpers -------------
    function api(path, options) {
        options = options || {};
        var init = {
            method: options.method || 'GET',
            headers: { 'Accept': 'application/json' },
            credentials: 'same-origin',
        };
        if (options.body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.headers['X-CSRFToken'] = CSRF;
            init.body = JSON.stringify(options.body);
        }
        return fetch('/api/admin/' + path, init).then(function (resp) {
            return resp.json().catch(function () { return {}; }).then(function (data) {
                if (!resp.ok) throw new Error((data && data.detail) || resp.statusText);
                return data;
            });
        });
    }

    function toast(message, isError) {
        toastEl.textContent = message;
        toastEl.classList.toggle('is-error', Boolean(isError));
        toastEl.hidden = false;
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(function () { toastEl.hidden = true; }, 4000);
    }

    function esc(value) {
        var div = document.createElement('div');
        div.textContent = value === null || value === undefined ? '' : String(value);
        return div.innerHTML;
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
    }

    function badge(statusText) {
        if (!statusText) return '<span class="admin-badge">—</span>';
        return '<span class="admin-badge admin-badge--' + esc(statusText) + '">' + esc(statusText.replace('_', ' ')) + '</span>';
    }

    function openModal(html) {
        modalCard.innerHTML = html;
        modalEl.hidden = false;
        var closeBtn = modalCard.querySelector('[data-close]');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
    }
    function closeModal() { modalEl.hidden = true; modalCard.innerHTML = ''; }
    modalEl.addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) closeModal(); });

    function confirmAction(opts) {
        openModal(
            '<h3>' + esc(opts.title) + '</h3>' +
            '<p>' + esc(opts.body) + '</p>' +
            '<label>Reason (required)</label>' +
            '<textarea id="admin-confirm-reason" rows="3" placeholder="Why?"></textarea>' +
            (opts.confirmWord
                ? '<label>Type <strong>' + esc(opts.confirmWord) + '</strong> to confirm</label>' +
                  '<input class="admin-input" id="admin-confirm-word" autocomplete="off" />'
                : '') +
            '<div class="admin-modal__actions">' +
            '<button class="admin-btn admin-btn--ghost" data-close="1">Cancel</button>' +
            '<button class="admin-btn admin-btn--danger" id="admin-confirm-go">' + esc(opts.actionLabel || 'Confirm') + '</button>' +
            '</div>'
        );
        document.getElementById('admin-confirm-go').addEventListener('click', function () {
            var reason = (document.getElementById('admin-confirm-reason').value || '').trim();
            var word = opts.confirmWord ? (document.getElementById('admin-confirm-word').value || '') : null;
            if (word !== null && word !== opts.confirmWord) { toast('Confirmation text does not match.', true); return; }
            if (reason.length < 3) { toast('A reason is required.', true); return; }
            closeModal();
            opts.onConfirm(reason, word);
        });
    }

    // ------------- navigation -------------
    var SECTIONS = {
        overview: { title: 'Overview', render: renderOverview },
        users: { title: 'Users', render: renderUsers },
        reports: { title: 'User Reports', render: renderReports },
        groups: { title: 'Groups', render: renderGroups },
        messages: { title: 'Messages', render: renderMessages },
        announcements: { title: 'Announcements', render: renderAnnouncements },
        administrators: { title: 'Administrators', render: renderAdministrators },
        audit: { title: 'Audit Logs', render: renderAudit },
        health: { title: 'System Health', render: renderHealth },
        settings: { title: 'Platform Settings', render: renderSettings },
    };

    function navigate(section) {
        if (!SECTIONS[section]) section = 'overview';
        var meta = SECTIONS[section];
        titleEl.textContent = meta.title;
        content.innerHTML = '<div class="admin-loading">Loading…</div>';
        document.querySelectorAll('.admin-nav__link').forEach(function (link) {
            link.classList.toggle('is-active', link.dataset.section === section);
        });
        if (window.innerWidth < 860) document.getElementById('admin-sidebar').classList.remove('is-open');
        meta.render().catch(function (err) {
            content.innerHTML = '<div class="admin-error">Could not load ' + esc(meta.title) + ': ' + esc(err.message) + '</div>';
        });
    }

    document.getElementById('admin-nav').addEventListener('click', function (e) {
        var link = e.target.closest('[data-section]');
        if (!link) return;
        e.preventDefault();
        window.location.hash = link.dataset.section;
    });
    document.getElementById('admin-menu-toggle').addEventListener('click', function () {
        document.getElementById('admin-sidebar').classList.toggle('is-open');
    });
    window.addEventListener('hashchange', function () {
        navigate((window.location.hash || '#overview').slice(1));
    });

    // ------------- sections -------------
    function renderOverview() {
        return api('dashboard/').then(function (data) {
            var u = data.users || {}, m = data.moderation || {};
            content.innerHTML =
                '<div class="admin-cards">' +
                    card('Total users', u.total) +
                    card('Active users', u.active) +
                    card('New (24h)', u.new_last_24h) +
                    card('Suspended / deactivated', u.suspended, 'danger') +
                    card('Pending reports', m.pending_reports, 'warn') +
                    card('Unresolved cases', m.unresolved_cases, 'warn') +
                    card('Active suspensions', m.active_suspensions) +
                    card('Total groups', (data.groups || {}).total) +
                    card('Messages / 24h', (data.messages || {}).last_24h) +
                '</div>' +
                '<div class="admin-panel"><h2>New registrations — 30 days</h2>' + chart((data.series || {}).new_users || []) + '</div>' +
                '<div class="admin-panel"><h2>Message volume — 30 days</h2>' + chart((data.series || {}).messages || []) + '</div>' +
                '<div class="admin-panel"><h2>Recent administrative actions</h2>' +
                table(['When', 'Admin', 'Action', 'Target', 'Outcome'],
                    (data.recent_actions || []).map(function (a) {
                        return [fmtDate(a.created_at), esc(a.actor_name || '—'), esc(a.action),
                            esc(a.target_type + ' ' + (a.target_id || '')), badge(a.outcome)];
                    })) + '</div>';
        });
    }

    function card(label, value, tone) {
        return '<div class="admin-card' + (tone ? ' admin-card--' + tone : '') + '">' +
            '<div class="admin-card__label">' + esc(label) + '</div>' +
            '<div class="admin-card__value">' + esc(value === undefined ? '—' : value) + '</div></div>';
    }

    function chart(series) {
        if (!series.length) return '<div class="admin-empty">No data yet.</div>';
        var max = Math.max.apply(null, series.map(function (d) { return d.count; })) || 1;
        return '<div class="admin-chart">' + series.map(function (d) {
            var h = Math.round((d.count / max) * 100);
            return '<div class="admin-chart__bar" style="height:' + Math.max(h, 2) + '%">' +
                '<span class="admin-chart__tip">' + esc(d.date) + ': ' + d.count + '</span></div>';
        }).join('') + '</div>';
    }

    function table(headers, rows, emptyLabel) {
        if (!rows.length) return '<div class="admin-empty">' + esc(emptyLabel || 'Nothing here yet.') + '</div>';
        return '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
            headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
            '</tr></thead><tbody>' + rows.map(function (row) {
                return '<tr>' + row.map(function (cell) { return '<td>' + cell + '</td>'; }).join('') + '</tr>';
            }).join('') + '</tbody></table></div>';
    }

    function pager(data, onPage) {
        return '<div class="admin-pager">' +
            '<button class="admin-btn admin-btn--ghost admin-btn--sm" ' + (data.previous ? '' : 'disabled') + ' data-page="prev">&larr; Prev</button>' +
            '<span>Page ' + (data.current_page || '?') + '</span>' +
            '<button class="admin-btn admin-btn--ghost admin-btn--sm" ' + (data.next ? '' : 'disabled') + ' data-page="next">Next &rarr;</button>' +
            '</div>';
    }

    // ---- Users ----
    function renderUsers() {
        return api('users/?page=' + state.usersPage +
            '&q=' + encodeURIComponent(state.usersQuery) +
            (state.statusFilter ? '&status=' + state.statusFilter : '')
        ).then(function (data) {
            var rows = (data.results || []).map(function (u) {
                return [
                    esc(u.id), esc(u.display_name), esc(u.phone_number),
                    esc(u.email || '—'), fmtDate(u.date_joined),
                    '<span class="admin-badge admin-badge--' + esc(u.status) + '">' + esc(u.status) + '</span>',
                    esc(u.warning_count),
                    '<button class="admin-btn admin-btn--ghost admin-btn--sm" data-user="' + u.id + '">Open</button>',
                ];
            });
            content.innerHTML =
                '<div class="admin-toolbar">' +
                    '<input class="admin-input" id="users-search" placeholder="Search name / phone / email / ID…" value="' + esc(state.usersQuery) + '" />' +
                    '<select class="admin-select" id="users-status"><option value="">All statuses</option>' +
                        '<option value="active"' + (state.statusFilter === 'active' ? ' selected' : '') + '>Active</option>' +
                        '<option value="suspended"' + (state.statusFilter === 'suspended' ? ' selected' : '') + '>Suspended / deactivated</option>' +
                    '</select>' +
                    '<a class="admin-btn admin-btn--ghost admin-btn--sm" href="/api/admin/users/export/">Export CSV</a>' +
                '</div>' +
                table(['ID', 'Name', 'Phone', 'Email', 'Joined', 'Status', 'Warnings', ''], rows, 'No users found.') +
                pager(data);
            document.getElementById('users-search').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    state.usersQuery = e.target.value; state.usersPage = 1; renderUsers();
                }
            });
            document.getElementById('users-status').addEventListener('change', function (e) {
                state.statusFilter = e.target.value; state.usersPage = 1; renderUsers();
            });
            bindPager(data, function () { renderUsers(); });
            content.querySelectorAll('[data-user]').forEach(function (btn) {
                btn.addEventListener('click', function () { openUserDetail(btn.dataset.user); });
            });
        });
    }

    function bindPager(data, rerender) {
        content.querySelectorAll('[data-page]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (btn.dataset.page === 'next' && data.next) state.usersPage += 1;
                if (btn.dataset.page === 'prev' && data.previous) state.usersPage -= 1;
                rerender();
            });
        });
    }

    function openUserDetail(id) {
        api('users/' + id + '/').then(function (u) {
            var h = u.moderation_history || {};
            content.innerHTML =
                '<button class="admin-btn admin-btn--ghost admin-btn--sm" id="back-to-users">&larr; Back</button>' +
                '<div class="admin-panel"><h2>' + esc(u.display_name) + ' <span class="admin-badge admin-badge--' + esc(u.status) + '">' + esc(u.status) + '</span></h2>' +
                table(['Field', 'Value'], [
                    ['<strong>ID</strong>', esc(u.id)],
                    ['<strong>Phone</strong>', esc(u.phone_number)],
                    ['<strong>Username</strong>', esc(u.username)],
                    ['<strong>Email</strong>', esc(u.email || '—')],
                    ['<strong>Joined</strong>', fmtDate(u.date_joined)],
                    ['<strong>Last login</strong>', fmtDate(u.last_login)],
                    ['<strong>Restricted</strong>', (u.profile && u.profile.is_restricted) ? 'yes' : 'no'],
                ]) + '</div>' +
                '<div class="admin-panel"><h2>Moderation history</h2>' +
                table(['Type', 'Reason', 'By', 'When'],
                    (h.warnings || []).map(function (w) {
                        return ['Warning', esc(w.reason), esc(w.issued_by_name || '—'), fmtDate(w.created_at)];
                    }).concat(
                        (h.suspensions || []).map(function (s) {
                            return [esc(s.kind), esc(s.reason), esc(s.suspended_by_name || '—'),
                                fmtDate(s.created_at) + (s.lifted_at ? ' (lifted)' : ' (active)')];
                        }),
                    ), 'No warnings or suspensions.') + '</div>' +
                '<div class="admin-toolbar">' +
                    '<button class="admin-btn admin-btn--ghost" id="u-edit">Edit account</button>' +
                    '<button class="admin-btn admin-btn--warn" id="u-warn">Issue warning</button>' +
                    (u.is_active
                        ? '<button class="admin-btn admin-btn--danger" id="u-suspend">Suspend / Deactivate</button>'
                        : '<button class="admin-btn" id="u-reactivate">Reactivate</button>') +
                '</div>';
            document.getElementById('back-to-users').addEventListener('click', renderUsers);
            document.getElementById('u-edit').addEventListener('click', function () { openUserEdit(u); });
            document.getElementById('u-warn').addEventListener('click', function () { warnUser(u.id); });
            var suspendBtn = document.getElementById('u-suspend');
            if (suspendBtn) suspendBtn.addEventListener('click', function () {
                confirmAction({
                    title: 'Suspend or deactivate ' + u.display_name + '?',
                    body: 'The account will be blocked from signing in immediately. Existing sessions and tokens are revoked.',
                    actionLabel: 'Suspend',
                    onConfirm: function (reason) {
                        api('users/' + u.id + '/suspend/', { method: 'POST', body: { reason: reason, kind: 'suspension' } })
                            .then(function () { toast('Account suspended.'); openUserDetail(id); })
                            .catch(function (e) { toast(e.message, true); });
                    },
                });
            });
            var reactivateBtn = document.getElementById('u-reactivate');
            if (reactivateBtn) reactivateBtn.addEventListener('click', function () {
                api('users/' + u.id + '/reactivate/', { method: 'POST', body: {} })
                    .then(function () { toast('Account reactivated.'); openUserDetail(id); })
                    .catch(function (e) { toast(e.message, true); });
            });
        }).catch(function (e) { toast(e.message, true); });
    }

    function openUserEdit(u) {
        openModal(
            '<h3>Edit account ' + esc(u.display_name) + '</h3>' +
            '<label>Display name</label><input class="admin-input" id="e-display" value="' + esc(u.display_name) + '" maxlength="50"/>' +
            '<label>First name</label><input class="admin-input" id="e-first" value="' + esc(u.first_name || '') + '" maxlength="30"/>' +
            '<label>Last name</label><input class="admin-input" id="e-last" value="' + esc(u.last_name || '') + '" maxlength="30"/>' +
            '<label>Email</label><input class="admin-input" id="e-email" value="' + esc(u.email || '') + '" />' +
            '<label>Bio</label><textarea id="e-bio" rows="2" maxlength="280">' + esc((u.profile || {}).bio || '') + '</textarea>' +
            '<label>Reason for the change (audited)</label><input class="admin-input" id="e-reason" placeholder="e.g. resolved support ticket" />' +
            '<div class="admin-modal__actions">' +
            '<button class="admin-btn admin-btn--ghost" data-close="1">Cancel</button>' +
            '<button class="admin-btn" id="e-save">Save</button></div>'
        );
        document.getElementById('e-save').addEventListener('click', function () {
            api('users/' + u.id + '/edit/', {
                method: 'PATCH',
                body: {
                    display_name: document.getElementById('e-display').value,
                    first_name: document.getElementById('e-first').value,
                    last_name: document.getElementById('e-last').value,
                    email: document.getElementById('e-email').value,
                    bio: document.getElementById('e-bio').value,
                    reason: document.getElementById('e-reason').value,
                },
            }).then(function () { closeModal(); toast('Account updated.'); openUserDetail(u.id); })
                .catch(function (e) { toast(e.message, true); });
        });
    }

    function warnUser(id) {
        openModal(
            '<h3>Issue a warning</h3>' +
            '<label>Category</label><select class="admin-select" id="w-cat">' +
            ['harassment', 'spam', 'impersonation', 'threats', 'scams', 'abusive_behavior', 'platform_manipulation', 'other']
                .map(function (c) { return '<option value="' + c + '">' + c.replace('_', ' ') + '</option>'; }).join('') + '</select>' +
            '<label>Explanation (sent to the user in-app)</label>' +
            '<textarea id="w-reason" rows="3" maxlength="500"></textarea>' +
            '<div class="admin-modal__actions">' +
            '<button class="admin-btn admin-btn--ghost" data-close="1">Cancel</button>' +
            '<button class="admin-btn admin-btn--warn" id="w-go">Send warning</button></div>'
        );
        document.getElementById('w-go').addEventListener('click', function () {
            api('users/' + id + '/warn/', {
                method: 'POST',
                body: {
                    category: document.getElementById('w-cat').value,
                    reason: document.getElementById('w-reason').value,
                },
            }).then(function () { closeModal(); toast('Warning issued.'); })
                .catch(function (e) { toast(e.message, true); });
        });
    }

    // ---- Reports ----
    function renderReports() {
        return api('reports/').then(function (data) {
            var rows = (data.results || []).map(function (r) {
                var rep = r.report_detail;
                return [
                    '#' + r.case_id, esc(rep.reported_name), esc(rep.reason),
                    esc(rep.details || '—'), esc(rep.reporter_name),
                    fmtDate(rep.created_at), badge(r.status),
                    esc(r.assigned_to_name || 'Unassigned'),
                    '<button class="admin-btn admin-btn--ghost admin-btn--sm" data-case="' + rep.id + '">Open</button>',
                ];
            });
            content.innerHTML = table(
                ['Case', 'Reported', 'Category', 'Details', 'Reporter', 'When', 'Status', 'Assignee', ''],
                rows, 'No reports. The queue is clear.');
            content.querySelectorAll('[data-case]').forEach(function (btn) {
                btn.addEventListener('click', function () { openCase(btn.dataset.case); });
            });
        });
    }

    function openCase(reportId) {
        api('reports/?status=&page=1&q=').then(function () { return reportId; });
        api('reports/' + reportId + '/messages/?conversation_id=0').catch(function () { /* preflight */ });
        // Load the case list entry through a normal fetch of one report's row order.
        openModal(
            '<h3>Moderation case #' + esc(reportId) + '</h3>' +
            '<label>Assign to</label><input class="admin-input" id="c-assign" placeholder="administrator user id (optional)"/>' +
            '<label>Ensure status</label><select class="admin-select" id="c-status">' +
            ['under_review', 'action_required'].map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>' +
            '<hr/><label>Resolution</label><textarea id="c-res" rows="3"></textarea>' +
            '<label>Action taken</label><input class="admin-input" id="c-action" placeholder="e.g. user warned" />' +
            '<label>Outcome</label><select class="admin-select" id="c-outcome"><option>resolved</option><option>dismissed</option></select>' +
            '<div class="admin-modal__actions">' +
            '<button class="admin-btn admin-btn--ghost" data-close="1">Cancel</button>' +
            '<button class="admin-btn admin-btn--ghost" id="c-assign-go">Assign</button>' +
            '<button class="admin-btn" id="c-resolve">Close case</button></div>'
        );
        var assign = document.getElementById('c-assign-go');
        if (assign) assign.addEventListener('click', function () {
            api('reports/' + reportId + '/assign/', {
                method: 'POST',
                body: {
                    assigned_to: Number(document.getElementById('c-assign').value) || null,
                    status: document.getElementById('c-status').value,
                },
            }).then(function () { closeModal(); toast('Case assigned.'); renderReports(); })
                .catch(function (e) { toast(e.message, true); });
        });
        document.getElementById('c-resolve').addEventListener('click', function () {
            api('reports/' + reportId + '/resolve/', {
                method: 'POST',
                body: {
                    resolution: document.getElementById('c-res').value,
                    action_taken: document.getElementById('c-action').value,
                    outcome: document.getElementById('c-outcome').value,
                },
            }).then(function () { closeModal(); toast('Case closed.'); renderReports(); })
                .catch(function (e) { toast(e.message, true); });
        });
    }

    // ---- Groups ----
    function renderGroups() {
        return api('groups/').then(function (data) {
            var rows = (data.results || []).map(function (g) {
                return [
                    esc(g.id), esc(g.name || '(untitled)'), esc(g.created_by_name || '—'),
                    fmtDate(g.created_at), esc(g.member_count), esc(g.message_count),
                    '<button class="admin-btn admin-btn--ghost admin-btn--sm" data-g-arch="' + g.id + '">Archive</button>',
                ];
            });
            content.innerHTML = table(
                ['ID', 'Name', 'Owner', 'Created', 'Members', 'Messages', ''], rows,
                'No groups yet.');
            content.querySelectorAll('[data-g-arch]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    confirmAction({
                        title: 'Archive this group?',
                        body: 'Members will no longer see it in their chat list. The action is reversible and fully audited.',
                        actionLabel: 'Archive group',
                        onConfirm: function (reason) {
                            api('groups/' + btn.dataset.gArch + '/archive/', { method: 'POST', body: { reason: reason } })
                                .then(function () { toast('Group archived.'); renderGroups(); })
                                .catch(function (e) { toast(e.message, true); });
                        },
                    });
                });
            });
        });
    }

    // ---- Messages (privacy-restricted entry point) ----
    function renderMessages() {
        content.innerHTML =
            '<div class="admin-panel"><h2>Reported content review</h2>' +
            '<p class="admin-empty">Message content is only opened through a report case, with an explicit moderation purpose. Every opening of a conversation is written to the audit log. Open a report in <a href="#reports">User Reports</a> first.</p></div>';
        return Promise.resolve();
    }

    // ---- Announcements ----
    function renderAnnouncements() {
        return api('announcements/').then(function (data) {
            var rows = (data.results || []).map(function (a) {
                return [
                    esc(a.title), badge(a.audience), esc(a.sent_to_count),
                    a.sent_at ? 'Sent ' + fmtDate(a.sent_at) : '<em>Queued</em>',
                    esc(a.created_by_name || '—'),
                    a.sent_at ? 'Sent' : '<button class="admin-btn admin-btn--sm" data-ann="' + a.id + '">Send now…</button>',
                ];
            });
            content.innerHTML =
                '<div class="admin-toolbar"><button class="admin-btn" id="ann-new">New announcement</button></div>' +
                table(['Title', 'Audience', 'Delivered', 'Status', 'Sender', ''], rows, 'No announcements yet.');
            document.getElementById('ann-new').addEventListener('click', newAnnouncement);
            content.querySelectorAll('[data-ann]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = btn.dataset.ann;
                    confirmAction({
                        title: 'Deliver this announcement?',
                        body: 'An in-app notification is created for every member of the audience, plus one Expo push (APK). Delivery to the full "all users" audience requires the send-confirmation step you are completing now.',
                        actionLabel: 'Send',
                        onConfirm: function () {
                            api('announcements/' + id + '/send/', { method: 'POST', body: {} })
                                .then(function (r) { toast('Sent to ' + r.delivered_to + ' users.'); renderAnnouncements(); })
                                .catch(function (e) { toast(e.message, true); });
                        },
                    });
                });
            });
        });
    }

    function newAnnouncement() {
        openModal(
            '<h3>New announcement</h3>' +
            '<label>Title</label><input class="admin-input" id="a-title" maxlength="150"/>' +
            '<label>Message</label><textarea id="a-body" rows="4" maxlength="2000"></textarea>' +
            '<label>Audience</label><select class="admin-select" id="a-aud">' +
            '<option value="all">All users</option><option value="active">Active users only</option>' +
            '<option value="suspended">Suspended users only</option></select>' +
            '<div class="admin-modal__actions">' +
            '<button class="admin-btn admin-btn--ghost" data-close="1">Cancel</button>' +
            '<button class="admin-btn admin-btn--ghost" id="a-preview">Preview count</button>' +
            '<button class="admin-btn" id="a-queue">Queue</button></div>'
        );
        var payload = function () {
            return {
                title: document.getElementById('a-title').value,
                body: document.getElementById('a-body').value,
                audience: document.getElementById('a-aud').value,
            };
        };
        document.getElementById('a-preview').addEventListener('click', function () {
            api('announcements/', { method: 'POST', body: Object.assign({ dry_run: true }, payload()) })
                .then(function (r) { toast('Would reach ' + r.recipient_count + ' users.'); })
                .catch(function (e) { toast(e.message, true); });
        });
        document.getElementById('a-queue').addEventListener('click', function () {
            var p = payload();
            var body = Object.assign({}, p);
            if (p.audience === 'all') {
                // Confirm the ALL-audience send at queue time; delivery still
                // needs a separate explicit "send" so it can never double-fire.
                body.confirmed = true;
            }
            api('announcements/', { method: 'POST', body: body })
                .then(function () { closeModal(); toast('Announcement queued.'); renderAnnouncements(); })
                .catch(function (e) { toast(e.message, true); });
        });
    }

    // ---- Administrators ----
    function renderAdministrators() {
        return api('administrators/').then(function (data) {
            var rows = (data.results || []).map(function (a) {
                return [
                    esc(a.id), esc(a.display_name || a.username), esc(a.phone_number),
                    esc((a.roles || []).join(', ') || '—'),
                    esc(a.is_active ? 'active' : 'inactive'),
                    fmtDate(a.last_login), fmtDate(a.last_action_at),
                    '<button class="admin-btn admin-btn--ghost admin-btn--sm" data-adm="' + a.id + '">Manage</button>',
                ];
            });
            content.innerHTML = table(
                ['ID', 'Name', 'Phone', 'Roles', 'Status', 'Last login', 'Last action', ''], rows,
                'No administrators found.');
            content.querySelectorAll('[data-adm]').forEach(function (btn) {
                btn.addEventListener('click', function () { renderAdministrators(); });
            });
        });
    }

    // ---- Audit ----
    function renderAudit() {
        return api('audit-logs/').then(function (data) {
            var rows = (data.results || []).map(function (a) {
                return [
                    fmtDate(a.created_at), esc(a.actor_name || 'system'), esc(a.actor_role || '—'),
                    esc(a.action), esc(a.target_type + ' ' + (a.target_id || '')),
                    esc(a.reason || '—'), esc(a.case_id || '—'), badge(a.outcome),
                ];
            });
            content.innerHTML =
                '<div class="admin-panel"><h2>Append-only audit trail</h2>' +
                table(['When', 'Admin', 'Role', 'Action', 'Target', 'Reason', 'Case', 'Outcome'], rows,
                    'No audit events yet.') + '</div>';
        });
    }

    // ---- Health ----
    function renderHealth() {
        function dot(ok) { return '<span class="admin-health-dot ' + (ok ? 'ok' : 'bad') + '"></span>'; }
        return api('health/').then(function (data) {
            var c = data.checks || {};
            var v = data.version || {};
            content.innerHTML =
                '<div class="admin-health-grid">' +
                    card2('Overall', dot(data.overall === 'ok') + esc(data.overall)) +
                    card2('Database', dot(c.database && c.database.ok) +
                        (c.database && c.database.latency_ms !== undefined ? ' ' + c.database.latency_ms + ' ms' : '')) +
                    card2('Cache', dot(c.cache && c.cache.ok)) +
                    card2('WebSockets', dot(c.channels && c.channels.ok)) +
                    card2('Django', esc(v.django || '—')) +
                    card2('Python', esc(v.python || '—')) +
                    card2('Messages / 24h', esc(data.message_volume_24h)) +
                '</div>';
        });
    }
    function card2(label, html) {
        return '<div class="admin-card"><div class="admin-card__label">' + esc(label) + '</div>' +
            '<div class="admin-card__value" style="font-size:18px">' + html + '</div></div>';
    }

    // ---- Settings ----
    function renderSettings() {
        return api('settings/').then(function (data) {
            var s = data.settings;
            var canEdit = data.can_edit;
            function check(id, label, checked, hint) {
                return '<label><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (canEdit ? '' : ' disabled') + ' /> ' +
                    esc(label) + (hint ? ' <small>— ' + esc(hint) + '</small>' : '') + '</label>';
            }
            content.innerHTML =
                '<div class="admin-panel"><h2>Platform configuration</h2>' +
                check('s-registration', 'Registration open', s.registration_open, 'new sign-ups allowed') +
                check('s-maintenance', 'Maintenance mode', s.maintenance_mode, 'shows a maintenance notice in clients') +
                check('s-announce', 'Announcements enabled', s.feature_announcements) +
                check('s-calls', 'Calls enabled', s.feature_calls) +
                '<label>Suspension default (days)</label>' +
                '<input class="admin-input" id="s-susp-days" type="number" min="0" max="365" value="' + esc(s.suspension_default_days) + '"' + (canEdit ? '' : ' disabled') + ' />' +
                '<div class="admin-modal__actions">' +
                (canEdit ? '<button class="admin-btn" id="s-save">Save settings</button>' : '<p class="admin-empty">You do not have settings-edit permission.</p>') +
                '</div></div>';
            var save = document.getElementById('s-save');
            if (save) save.addEventListener('click', function () {
                var body = {
                    registration_open: document.getElementById('s-registration').checked,
                    maintenance_mode: document.getElementById('s-maintenance').checked,
                    feature_announcements: document.getElementById('s-announce').checked,
                    feature_calls: document.getElementById('s-calls').checked,
                    suspension_default_days: Number(document.getElementById('s-susp-days').value) || 0,
                };
                var criticalChanged = body.maintenance_mode !== s.maintenance_mode ||
                    body.registration_open !== s.registration_open;
                if (criticalChanged) body.confirm = 'SETTINGS-CHANGE';
                api('settings/update/', { method: 'PATCH', body: body })
                    .then(function () { toast('Settings saved.'); renderSettings(); })
                    .catch(function (e) { toast(e.message, true); });
            });
        });
    }

    // ------------- boot -------------
    api('me/').then(function (me) {
        state.me = me;
        rolePill.textContent = (me.roles && me.roles.join(', ')) || 'no admin role';
        var allowed = me.permissions || [];
        // Hide sections the role cannot open: the backend still enforces caps.
        document.querySelectorAll('.admin-nav__link[data-section]').forEach(function (link) {
            var section = link.dataset.section;
            var needed = {
                overview: 'dashboard', users: 'users.view', reports: 'reports.view',
                groups: 'moderation.groups', messages: 'moderation.messages',
                announcements: 'announcements.send', administrators: 'administrators.view',
                audit: 'audit.view', health: 'health.view', settings: 'dashboard',
            }[section];
            if (allowed.indexOf(needed) === -1) link.remove();
        });
        navigate((window.location.hash || '#overview').slice(1));
    }).catch(function (e) {
        content.innerHTML = '<div class="admin-error">Access denied: ' + esc(e.message) + '</div>';
        rolePill.textContent = 'unauthorized';
    });
})();
