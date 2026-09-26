/* ==========================================================================
   NEXLINK — chat.js
   Chat application logic. DOM is built with createElement/textContent
   (never innerHTML with user data) so message content is XSS-safe.
   ========================================================================== */

(function () {
    'use strict';

    var API = window.PulseAPI;
    var Socket = window.PulseSocket;

    var ME = (window.NEXLINK || {}).currentUserId;
    var PAGE_SIZE = 50;
    var state = {
        conversationId: (window.NEXLINK || {}).conversationId || null,
        conversations: {},   // id -> conversation object
        messages: {},        // conversationId -> [message]
        replyTo: null,       // message being replied to
        typingTimers: {},    // username -> timeout
        peerTyping: {},      // conversationId -> {username: timeout}
        hasMore: {},         // conversationId -> bool (older pages exist)
        loadingOlder: false,
        contacts: {},        // userId -> contact entry (Friends tab)
        contactsLoaded: false,
        activeTab: 'chats',
        filter: 'all',       // all | unread | friends | groups
    };

    var els = {};

    /* ======================================================================
       Utilities
       ====================================================================== */

    function $(id) { return document.getElementById(id); }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function formatTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function formatDay(iso) {
        var d = new Date(iso);
        var today = new Date();
        var yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);
        if (d.toDateString() === today.toDateString()) return 'Today';
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }

    /* WhatsApp list-style time: HH:MM today, "Yesterday", else short date. */
    function formatListTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        var today = new Date();
        var yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);
        if (d.toDateString() === today.toDateString()) return formatTime(iso);
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return d.toLocaleDateString([], { day: 'numeric', month: 'numeric', year: '2-digit' });
    }

    /* Stable per-user hue for group sender-name colors. */
    function hueFor(id) {
        var n = Number(id) || 0;
        return (n * 137) % 360;
    }

    function relativeLastSeen(iso) {
        if (!iso) return 'offline';
        var minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (minutes < 1) return 'last seen just now';
        if (minutes < 60) return 'last seen ' + minutes + ' min ago';
        var hours = Math.round(minutes / 60);
        if (hours < 24) return 'last seen ' + hours + ' h ago';
        return 'last seen ' + formatDay(iso);
    }

    function toast(text, isError) {
        var stack = $('toast-stack');
        if (!stack) return;
        var node = el('div', 'toast' + (isError ? ' toast--error' : ''), text);
        stack.appendChild(node);
        setTimeout(function () { node.remove(); }, 3500);
    }

    /* ======================================================================
       Conversations sidebar
       ====================================================================== */

    function loadConversations() {
        return API.get('/api/conversations/').then(function (data) {
            state.conversations = {};
            (data || []).forEach(function (c) { state.conversations[c.id] = c; });
            renderConversationList();
        }).catch(function (err) {
            toast('Could not load conversations: ' + err.message, true);
        });
    }

    function peerOf(conversation) {
        var participants = conversation.participants || [];
        for (var i = 0; i < participants.length; i++) {
            if (participants[i].id !== ME) return participants[i];
        }
        return participants[0] || null;
    }

    function conversationLabel(conversation) {
        if (conversation.kind === 'group') return conversation.name || 'Group chat';
        var peer = peerOf(conversation);
        return peer ? (peer.display_name || 'Conversation') : 'Conversation';
    }

    function buildConversationRow(c) {
        var peer = peerOf(c);
        var unread = c.unread_count > 0;
        var li = el('li', 'conv-item' + (c.id === state.conversationId ? ' is-active' : '') +
            (unread ? ' conv-item--unread' : ''));
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');

        var avatar = el('div', 'avatar avatar--sm');
        if (c.kind === 'group') {
            avatar.appendChild(el('span', 'avatar__initials',
                (c.name || 'Group').slice(0, 2).toUpperCase()));
        } else if (peer && peer.avatar_url) {
            var img = el('img');
            img.src = peer.avatar_url;
            img.alt = '';
            avatar.appendChild(img);
        } else {
            avatar.appendChild(el('span', 'avatar__initials',
                (peer && peer.display_name ? peer.display_name.slice(0, 2) : '??').toUpperCase()));
            if (peer && peer.is_online) avatar.appendChild(el('span', 'presence-dot presence-dot--online'));
        }

        var body = el('div', 'conv-item__body');

        var nameRow = el('div', 'conv-item__name');
        nameRow.appendChild(el('span', null, conversationLabel(c)));
        var lastMsg = c.last_message;
        nameRow.appendChild(el('span', 'conv-item__time',
            lastMsg ? formatListTime(lastMsg.created_at) : ''));

        var previewRow = el('div', 'conv-item__preview');
        var typingNow = state.peerTyping[c.id] && Object.keys(state.peerTyping[c.id]).length;
        if (typingNow) {
            previewRow.appendChild(el('span', 'is-typing', 'typing…'));
        } else if (lastMsg) {
            var prefix = lastMsg.sender_id === ME ? 'You: ' : '';
            var previewText = prefix + (lastMsg.is_deleted ? 'Message deleted' : lastMsg.body);
            previewRow.appendChild(el('span', null, previewText));
        } else {
            previewRow.appendChild(el('span', null, 'No messages yet'));
        }
        if (c.unread_count > 0) {
            previewRow.appendChild(el('span', 'unread-pill', String(c.unread_count)));
        }

        body.appendChild(nameRow);
        body.appendChild(previewRow);
        li.appendChild(avatar);
        li.appendChild(body);

        function open() { openConversation(c.id); }
        li.addEventListener('click', open);
        li.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });

        return li;
    }

    function renderConversationList() {
        var list = $('conversation-list');
        if (!list) return;
        list.textContent = '';

        var items = Object.values(state.conversations).sort(function (a, b) {
            var ta = a.last_message ? new Date(a.last_message.created_at) : new Date(a.updated_at);
            var tb = b.last_message ? new Date(b.last_message.created_at) : new Date(b.updated_at);
            return tb - ta;
        });

        // WhatsApp filter chips: All / Unread / Friends / Groups.
        var filtered = items.filter(function (c) {
            if (state.filter === 'unread') return (c.unread_count || 0) > 0;
            if (state.filter === 'groups') return c.kind === 'group';
            if (state.filter === 'friends') {
                return c.kind !== 'group' && !!state.contacts[peerOf(c) && peerOf(c).id];
            }
            return true;
        });

        var empty = $('conv-empty');
        if (empty) {
            empty.hidden = filtered.length > 0;
            if (!empty.hidden && state.filter !== 'all') {
                empty.querySelector('p').textContent =
                    state.filter === 'unread' ? 'No unread chats.' :
                    state.filter === 'groups' ? 'No groups yet.' :
                    'No chats with friends yet.';
            }
        }

        filtered.forEach(function (c) {
            list.appendChild(buildConversationRow(c));
        });

        renderGroups(items);
        updateChatsBadge(items);
        updateUnreadChip(items);
    }

    function updateUnreadChip(items) {
        var chip = $('chip-unread-count');
        if (!chip) return;
        var total = (items || []).filter(function (c) {
            return (c.unread_count || 0) > 0;
        }).length;
        chip.hidden = total === 0;
        chip.textContent = String(total);
    }

    function renderGroups(items) {
        var list = $('groups-list');
        if (!list) return;
        list.textContent = '';

        var groups = (items || []).filter(function (c) { return c.kind === 'group'; });
        var empty = $('groups-empty');
        if (empty) empty.hidden = groups.length > 0;

        groups.forEach(function (c) {
            list.appendChild(buildConversationRow(c));
        });
    }

    function updateChatsBadge(items) {
        var badge = $('tab-chats-badge');
        if (!badge) return;
        var total = 0;
        (items || []).forEach(function (c) { total += c.unread_count || 0; });
        badge.hidden = total === 0;
        badge.textContent = total > 99 ? '99+' : String(total);
    }

    function updateConversationFromMessage(conversationId, message) {
        var c = state.conversations[conversationId];
        if (!c) {
            loadConversations();
            return;
        }
        c.last_message = {
            id: message.id,
            sender_id: message.sender.id,
            body: message.body,
            is_deleted: message.is_deleted,
            created_at: message.created_at,
        };
        if (message.sender.id !== ME) {
            c.unread_count = (c.unread_count || 0) + 1;
        }
        renderConversationList();
    }

    /* ======================================================================
       User search
       ====================================================================== */

    function bindSearch() {
        var input = $('conv-search');
        var resultsBox = $('search-results');
        var resultsList = $('user-results');
        if (!input || !resultsBox || !resultsList) return;

        var timer = null;
        input.addEventListener('input', function () {
            clearTimeout(timer);
            var q = input.value.trim();
            if (!q) {
                resultsBox.hidden = true;
                resultsList.textContent = '';
                return;
            }
            timer = setTimeout(function () {
                activateTab('chats');
                API.get('/api/users/search/?q=' + encodeURIComponent(q)).then(function (data) {
                    resultsList.textContent = '';
                    resultsBox.hidden = false;
                    (data.results || []).forEach(function (user) {
                        var li = el('li', 'conv-item');
                        li.setAttribute('role', 'button');
                        li.setAttribute('tabindex', '0');

                        var avatar = el('div', 'avatar avatar--sm');
                        if (user.avatar_url) {
                            var img = el('img');
                            img.src = user.avatar_url;
                            img.alt = '';
                            avatar.appendChild(img);
                        } else {
                            avatar.appendChild(el('span', 'avatar__initials',
                                (user.display_name || '??').slice(0, 2).toUpperCase()));
                        }

                        var body = el('div', 'conv-item__body');
                        var nameRow = el('div', 'conv-item__name');
                        nameRow.appendChild(el('span', null, user.display_name || 'Unknown'));
                        body.appendChild(nameRow);
                        if (user.about) body.appendChild(el('div', 'conv-item__preview', user.about));

                        var star = el('button', 'icon-btn conv-item__star', '★');
                        star.type = 'button';
                        function refreshStar() {
                            var saved = !!state.contacts[user.id];
                            star.classList.toggle('is-contact', saved);
                            star.title = saved ? 'Remove from friends' : 'Add to friends';
                            star.setAttribute('aria-label', star.title);
                        }
                        refreshStar();
                        star.addEventListener('click', function (e) {
                            e.stopPropagation();
                            if (state.contacts[user.id]) {
                                removeContact(user.id).then(refreshStar);
                            } else {
                                addContact(user).then(refreshStar);
                            }
                        });

                        li.appendChild(avatar);
                        li.appendChild(body);
                        li.appendChild(star);

                        function start() {
                            API.post('/api/conversations/start/', { user_id: user.id })
                                .then(function (conversation) {
                                    input.value = '';
                                    resultsBox.hidden = true;
                                    state.conversations[conversation.id] = conversation;
                                    renderConversationList();
                                    openConversation(conversation.id, true);
                                })
                                .catch(function (err) {
                                    toast('Could not start chat: ' + err.message, true);
                                });
                        }
                        li.addEventListener('click', start);
                        li.addEventListener('keydown', function (e) {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); }
                        });
                        resultsList.appendChild(li);
                    });
                }).catch(function (err) {
                    toast('Search failed: ' + err.message, true);
                });
            }, 300);
        });
    }

    /* ======================================================================
       Messages
       ====================================================================== */

    function messagesUrl(conversationId) {
        return '/api/conversations/' + conversationId + '/messages/';
    }

    function openConversation(conversationId, isNew) {
        if (state.conversationId && state.conversationId !== conversationId) {
            Socket.close();
        }
        state.conversationId = conversationId;
        state.replyTo = null;
        hideReplyPreview();

        var c = state.conversations[conversationId];
        if (c) {
            c.unread_count = 0;
            renderConversationList();
        }

        if (!isNew && window.history.replaceState) {
            window.history.replaceState(null, '', '/chat/' + conversationId + '/');
        }

        if (document.body.classList.contains('chat-body')) {
            document.getElementById('chat-app').classList.add('chat-app--active');
        }

        connectSocket(conversationId);
        loadMessages(conversationId).then(function () {
            if (c || isNew) updateHeader(conversationId);
            markReadUpTo();
        });
    }

    function connectSocket(conversationId) {
        // Reconnect to the new conversation; handlers are bound once in init.
        Socket.connect(conversationId, null);
        startUserSocketOnce();
    }

    function loadMessages(conversationId) {
        var container = els.messages || $('messages');
        if (!container) return Promise.resolve();
        container.textContent = '';
        container.appendChild(el('p', 'sidebar__empty', 'Loading…'));

        return API.get(messagesUrl(conversationId)).then(function (data) {
            state.messages[conversationId] = (data && data.results) || [];
            state.hasMore[conversationId] = !!(data && data.has_more);
            renderMessages(conversationId);
        }).catch(function (err) {
            container.textContent = '';
            container.appendChild(el('p', 'sidebar__empty', 'Could not load messages: ' + err.message));
        });
    }

    function loadOlderMessages() {
        var conversationId = state.conversationId;
        var container = els.messages || $('messages');
        if (!container || state.loadingOlder) return Promise.resolve();
        if (!state.hasMore[conversationId]) return Promise.resolve();

        var messages = state.messages[conversationId] || [];
        if (!messages.length) return Promise.resolve();

        state.loadingOlder = true;
        var previousHeight = container.scrollHeight;
        var beforeId = messages[0].id;

        return API.get(messagesUrl(conversationId) + '?before=' + beforeId)
            .then(function (data) {
                var older = (data && data.results) || [];
                state.hasMore[conversationId] = !!(data && data.has_more);
                if (older.length) {
                    state.messages[conversationId] = older.concat(messages);
                    renderMessages(conversationId);
                    // Keep the viewport anchored where the user was reading.
                    container.scrollTop = container.scrollHeight - previousHeight;
                }
            })
            .catch(function (err) {
                toast('Could not load older messages: ' + err.message, true);
            })
            .then(function () {
                state.loadingOlder = false;
            });
    }

    function renderMessages(conversationId) {
        var container = els.messages || $('messages');
        if (!container) return;
        container.textContent = '';

        var messages = state.messages[conversationId] || [];
        var empty = $('chat-empty');
        if (empty) empty.hidden = messages.length > 0;

        var lastDay = null;
        messages.forEach(function (m) {
            var day = new Date(m.created_at).toDateString();
            if (day !== lastDay) {
                lastDay = day;
                container.appendChild(el('div', 'date-sep', formatDay(m.created_at)));
            }
            container.appendChild(buildMessageNode(m, conversationId));
        });
        scrollToBottom();
    }

    function appendMessage(conversationId, message) {
        var messages = state.messages[conversationId] || (state.messages[conversationId] = []);
        var exists = messages.some(function (m) { return m.id === message.id; });
        if (exists) return;

        var container = els.messages || $('messages');
        if (!container) return;
        var empty = $('chat-empty');
        if (empty) empty.hidden = true;

        messages.push(message);
        container.appendChild(buildMessageNode(message, conversationId));
        scrollToBottom();
    }

    function buildMessageNode(m, conversationId) {
        var mine = m.sender.id === ME;
        var c = state.conversations[conversationId];
        var isGroup = c && c.kind === 'group';
        var row = el('div', 'msg ' + (mine ? 'msg--mine' : 'msg--theirs') +
            (m.is_deleted ? ' msg--deleted' : ''));
        row.setAttribute('data-message-id', m.id);

        var bubbleWrap = el('div');

        var bubble = el('div', 'msg__bubble');

        if (isGroup && !mine && !m.is_deleted) {
            var nameRow = el('div', 'msg__sender');
            nameRow.textContent = m.sender.display_name || 'Someone';
            nameRow.style.setProperty('--hue', hueFor(m.sender.id));
            bubble.appendChild(nameRow);
        }

        if (m.reply_to && !m.is_deleted) {
            var reply = el('div', 'msg__reply');
            var replyBody = m.reply_to.is_deleted
                ? 'Deleted message'
                : (m.reply_to.body || '');
            reply.textContent = (m.reply_to.sender_name || '') + ': ' + replyBody;
            bubble.appendChild(reply);
        }

        var bodyNode = el('div', 'msg__text');
        if (m.is_deleted) {
            bubble.appendChild(el('span', null, 'This message was deleted'));
        } else if (m.editing) {
            bubble.appendChild(buildEditBox(m, conversationId));
        } else {
            if (m.attachment_url) {
                appendAttachment(bubble, m);
            }
            if (m.body) {
                bodyNode.textContent = m.body; // textContent — safe rendering
                bubble.appendChild(bodyNode);
            }
        }

        // In-bubble meta: time + status ticks (mine), floated right.
        var meta = el('span', 'msg__meta');
        meta.appendChild(el('span', null, formatTime(m.created_at)));
        if (m.edited_at && !m.is_deleted) {
            meta.appendChild(el('span', 'msg__edited', '(edited)'));
        }
        if (mine && !m.is_deleted) {
            var status = el('span', 'msg__status');
            status.setAttribute('aria-label',
                (m.state === 'read' || (m.read_by && m.read_by.length)) ? 'Read' : 'Sent');
            var ticks = (m.state === 'read' || (m.read_by && m.read_by.length > 0))
                ? 'M1 6.5L4.5 10 11 3.5M8 9.5l1.5 1.5L16 4.5'
                : 'M1 6.5L4.5 10 11 3.5';
            status.innerHTML =
                '<svg viewBox="0 0 17 13" aria-hidden="true"><path d="' + ticks + '"/></svg>';
            meta.appendChild(status);
        }
        bubble.appendChild(meta);

        bubbleWrap.appendChild(bubble);

        // Reactions
        if (!m.is_deleted && m.reactions && m.reactions.length) {
            var reactionRow = el('div', 'msg__reactions');
            m.reactions.forEach(function (r) {
                var chip = el('button', 'reaction-chip' + (r.users.indexOf(ME) >= 0 ? ' is-mine' : ''));
                chip.type = 'button';
                chip.appendChild(el('span', null, r.emoji));
                chip.appendChild(el('span', null, r.count > 1 ? String(r.count) : ''));
                chip.title = r.count + ' reaction' + (r.count > 1 ? 's' : '');
                chip.addEventListener('click', function () {
                    toggleReaction(m.id, r.emoji);
                });
                reactionRow.appendChild(chip);
            });
            bubbleWrap.appendChild(reactionRow);
        }

        row.appendChild(bubbleWrap);

        // Hover actions (own + others' messages)
        if (!m.is_deleted) {
            var actions = el('div', 'msg__actions');
            actions.setAttribute('aria-label', 'Message actions');

            var reactBtn = el('button', 'icon-btn', '🙂');
            reactBtn.type = 'button';
            reactBtn.title = 'React';
            reactBtn.setAttribute('aria-label', 'Add reaction');
            reactBtn.addEventListener('click', function (e) {
                openReactionMenu(e.currentTarget, m.id);
            });
            actions.appendChild(reactBtn);

            if (!mine) {
                var replyBtn = el('button', 'icon-btn', '↩');
                replyBtn.type = 'button';
                replyBtn.title = 'Reply';
                replyBtn.setAttribute('aria-label', 'Reply to message');
                replyBtn.addEventListener('click', function () {
                    startReply(m);
                });
                actions.appendChild(replyBtn);
            }

            if (mine) {
                var editBtn = el('button', 'icon-btn', '✏️');
                editBtn.type = 'button';
                editBtn.title = 'Edit';
                editBtn.setAttribute('aria-label', 'Edit message');
                editBtn.addEventListener('click', function () {
                    startEditInline(m, conversationId);
                });
                actions.appendChild(editBtn);

                var delBtn = el('button', 'icon-btn', '🗑');
                delBtn.type = 'button';
                delBtn.title = 'Delete';
                delBtn.setAttribute('aria-label', 'Delete message');
                delBtn.addEventListener('click', function () {
                    deleteMessage(m.id, conversationId);
                });
                actions.appendChild(delBtn);
            }

            row.appendChild(actions);
        }

        return row;
    }

    function appendAttachment(container, message) {
        if (message.message_type === 'image') {
            var image = el('img', 'msg__attachment-image');
            image.src = message.attachment_url;
            image.alt = message.attachment_name || 'Attached image';
            container.appendChild(image);
            return;
        }
        var link = el('a', 'msg__attachment-link', message.attachment_name || 'Download attachment');
        link.href = message.attachment_url;
        link.target = '_blank';
        link.rel = 'noopener';
        container.appendChild(link);
    }

    function scrollToBottom() {
        var container = els.messages || $('messages');
        if (container) container.scrollTop = container.scrollHeight;
    }

    function findMessageNode(messageId) {
        var container = els.messages || $('messages');
        return container
            ? container.querySelector('[data-message-id="' + messageId + '"]')
            : null;
    }

    function findMessageData(messageId) {
        var messages = state.messages[state.conversationId] || [];
        return messages.find(function (m) { return m.id === messageId; }) || null;
    }

    /* ---------- Edit / delete / reply ---------- */

    function startEditInline(m, conversationId) {
        var node = findMessageNode(m.id);
        var bubble = node && node.querySelector('.msg__bubble');
        if (!bubble) return;
        bubble.textContent = '';
        bubble.appendChild(buildEditBox(m, conversationId, true));
        var textarea = bubble.querySelector('textarea');
        if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
    }

    function buildEditBox(m, conversationId, autofocus) {
        var box = el('div', 'edit-box');
        var textarea = el('textarea', 'edit-box__input');
        textarea.value = m.body;
        textarea.rows = 2;
        textarea.maxLength = 4000;
        textarea.setAttribute('aria-label', 'Edit message');

        var buttons = el('div', 'edit-box__buttons');
        var save = el('button', 'btn btn--primary', 'Save');
        save.type = 'button';
        var cancel = el('button', 'btn btn--secondary', 'Cancel');
        cancel.type = 'button';
        buttons.appendChild(save);
        buttons.appendChild(cancel);

        function doSave() {
            var body = textarea.value.trim();
            if (!body) return;
            API.patch('/api/messages/' + m.id + '/edit/', { body: body })
                .then(function () {
                    m.body = body;
                    m.edited_at = new Date().toISOString();
                    rerenderMessage(m.id);
                })
                .catch(function (err) { toast('Edit failed: ' + err.message, true); });
        }

        save.addEventListener('click', doSave);
        textarea.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSave();
            } else if (e.key === 'Escape') {
                rerenderMessage(m.id);
            }
        });
        cancel.addEventListener('click', function () { rerenderMessage(m.id); });

        box.appendChild(textarea);
        box.appendChild(buttons);
        return box;
    }

    function rerenderMessage(messageId) {
        var m = findMessageData(messageId);
        if (!m) return;
        var node = findMessageNode(messageId);
        if (!node) return;
        var fresh = buildMessageNode(m, state.conversationId);
        node.replaceWith(fresh);
    }

    function deleteMessage(messageId, conversationId) {
        if (!window.confirm('Delete this message?')) return;
        API.delete('/api/messages/' + messageId + '/delete/')
            .then(function () {
                var m = findMessageData(messageId);
                if (m) {
                    m.is_deleted = true;
                    m.body = '';
                }
                rerenderMessage(messageId);
                var c = state.conversations[conversationId];
                if (c && c.last_message && c.last_message.id === messageId) {
                    c.last_message.is_deleted = true;
                    renderConversationList();
                }
            })
            .catch(function (err) { toast('Delete failed: ' + err.message, true); });
    }

    function startReply(m) {
        state.replyTo = m;
        var box = $('reply-preview');
        if (!box) return;
        box.hidden = false;
        $('reply-preview-name').textContent = m.sender.display_name || m.sender.username;
        $('reply-preview-text').textContent = m.body;
        var input = $('message-input');
        if (input) input.focus();
    }

    function hideReplyPreview() {
        state.replyTo = null;
        var box = $('reply-preview');
        if (box) box.hidden = true;
    }

    /* ---------- Reactions ---------- */

    var reactionMenu = null;

    function openReactionMenu(anchor, messageId) {
        closeReactionMenu();
        var template = $('reaction-menu-template');
        if (!template) return;
        reactionMenu = template.content.firstElementChild.cloneNode(true);
        document.body.appendChild(reactionMenu);

        var rect = anchor.getBoundingClientRect();
        reactionMenu.style.left = Math.max(8, rect.left - 60) + 'px';
        reactionMenu.style.top = (rect.top - 48) + 'px';

        reactionMenu.querySelectorAll('[data-emoji]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                toggleReaction(messageId, btn.getAttribute('data-emoji'));
                closeReactionMenu();
            });
        });
        setTimeout(function () {
            document.addEventListener('click', onDocClickForMenu);
        }, 0);
    }

    function onDocClickForMenu(e) {
        if (reactionMenu && !reactionMenu.contains(e.target)) closeReactionMenu();
    }

    function closeReactionMenu() {
        if (reactionMenu) {
            reactionMenu.remove();
            reactionMenu = null;
            document.removeEventListener('click', onDocClickForMenu);
        }
    }

    function toggleReaction(messageId, emoji) {
        API.post('/api/messages/' + messageId + '/react/', { emoji: emoji })
            .then(function (data) {
                var m = findMessageData(messageId);
                if (!m) return;
                m.reactions = applyReactionLocally(m.reactions, data.added, emoji);
                rerenderMessage(messageId);
            })
            .catch(function (err) { toast('Reaction failed: ' + err.message, true); });
    }

    function applyReactionLocally(reactions, added, emoji) {
        var list = (reactions || []).map(function (r) {
            return { emoji: r.emoji, count: r.count, users: r.users.slice() };
        });
        var entry = list.find(function (r) { return r.emoji === emoji; });
        if (added) {
            if (entry) {
                entry.count++;
                entry.users.push(ME);
            } else {
                list.push({ emoji: emoji, count: 1, users: [ME] });
            }
        } else if (entry) {
            entry.count--;
            entry.users = entry.users.filter(function (id) { return id !== ME; });
            if (entry.count <= 0) list.splice(list.indexOf(entry), 1);
        }
        return list;
    }

    /* ======================================================================
       Composer
       ====================================================================== */

    var EMOJIS = ('😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 ' +
        '😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 ' +
        '😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 ' +
        '😯 😦 😧 😴 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ' +
        '💩 🤡 👻 👽 🤖 👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 🤝 🙏 💪 ❤️ 🧡 💛 💚 ' +
        '💙 💜 🖤 🔥 ✨ 🎉 🎊 🎁 🌹 🥀 💐 ☕ 🍕 🍔 🍟 🌮 🍿 ⚽ 🏀 🎮 🎵').split(/\s+/);

    function toggleEmojiPanel(force) {
        var panel = $('emoji-panel');
        if (!panel) return;
        var show = typeof force === 'boolean' ? force : panel.hidden;
        if (show && !panel.dataset.built) {
            EMOJIS.forEach(function (e) {
                var b = el('button', null, e);
                b.type = 'button';
                b.setAttribute('aria-label', 'Insert ' + e);
                b.addEventListener('click', function () {
                    var input = $('message-input');
                    if (!input) return;
                    var s = input.selectionStart || input.value.length;
                    var epos = input.selectionEnd || s;
                    input.value = input.value.slice(0, s) + e + input.value.slice(epos);
                    input.focus();
                    var np = s + e.length;
                    input.setSelectionRange(np, np);
                    notifyTyping();
                });
                panel.appendChild(b);
            });
            panel.dataset.built = '1';
        }
        panel.hidden = !show;
    }

    function bindComposer() {
        var form = $('composer');
        var input = $('message-input');
        if (!form || !input) return;
        var attachmentInput = $('attachment-input');
        var attachmentButton = $('attachment-button');
        if (attachmentButton && attachmentInput) {
            attachmentButton.addEventListener('click', function () {
                toggleEmojiPanel(false);
                attachmentInput.click();
            });
            attachmentInput.addEventListener('change', function () {
                var file = attachmentInput.files && attachmentInput.files[0];
                if (file) toast('Attached: ' + file.name);
            });
        }

        var emojiBtn = $('emoji-btn');
        if (emojiBtn) {
            emojiBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleEmojiPanel();
            });
        }
        document.addEventListener('click', function (e) {
            var panel = $('emoji-panel');
            if (panel && !panel.hidden && !panel.contains(e.target) &&
                e.target !== emojiBtn && !(emojiBtn && emojiBtn.contains(e.target))) {
                toggleEmojiPanel(false);
            }
        });

        // Auto-grow textarea
        input.addEventListener('input', function () {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 140) + 'px';
            notifyTyping();
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            sendMessage();
        });
    }

    function sendMessage() {
        var input = $('message-input');
        var body = input.value.trim();
        var attachmentInput = $('attachment-input');
        var file = attachmentInput && attachmentInput.files ? attachmentInput.files[0] : null;
        if ((!body && !file) || !state.conversationId) return;

        var payload = new FormData();
        payload.append('body', body);
        if (state.replyTo) payload.append('reply_to', state.replyTo.id);
        if (file) {
            payload.append('attachment', file);
            payload.append('message_type', attachmentType(file));
        }

        input.value = '';
        input.style.height = 'auto';
        if (attachmentInput) attachmentInput.value = '';
        hideReplyPreview();

        API.post(messagesUrl(state.conversationId), payload)
            .then(function (message) {
                appendMessage(state.conversationId, message);
                updateConversationFromMessage(state.conversationId, message);
            })
            .catch(function (err) {
                input.value = body; // restore so the user doesn't lose text
                toast('Could not send: ' + err.message, true);
            });
    }

    function attachmentType(file) {
        if (file.type.indexOf('image/') === 0) return 'image';
        if (file.type.indexOf('video/') === 0) return 'video';
        if (file.type.indexOf('audio/') === 0) return 'audio';
        return 'file';
    }

    /* ---------- Typing indicator (sender side) ---------- */

    var lastTypingSent = 0;
    var typingStopTimer = null;

    function notifyTyping() {
        var now = Date.now();
        if (now - lastTypingSent > 2000) {
            lastTypingSent = now;
            Socket.send({ type: 'typing', is_typing: true });
        }
        clearTimeout(typingStopTimer);
        typingStopTimer = setTimeout(function () {
            Socket.send({ type: 'typing', is_typing: false });
            lastTypingSent = 0;
        }, 2500);
    }

    /* ======================================================================
       Read receipts
       ====================================================================== */

    function markReadUpTo() {
        var messages = state.messages[state.conversationId] || [];
        var last = messages[messages.length - 1];
        if (!last) return;
        API.post('/api/conversations/' + state.conversationId + '/read/',
                 { message_id: last.id })
            .then(function () {
                var c = state.conversations[state.conversationId];
                if (c) c.unread_count = 0;
                renderConversationList();
            })
            .catch(function () { /* non-critical */ });
    }

    /* ======================================================================
       Header (peer info)
       ====================================================================== */

    function updateHeader(conversationId) {
        var c = state.conversations[conversationId];
        var nameEl = $('chat-peer-name');
        var statusEl = $('chat-peer-status');
        var avatarEl = $('chat-peer-avatar');
        var infoBtn = $('chat-info-btn');
        if (!c) {
            if (nameEl) nameEl.textContent = 'Conversation';
            if (infoBtn) infoBtn.hidden = true;
            return;
        }
        if (infoBtn) infoBtn.hidden = c.kind !== 'group';
        var peer = peerOf(c);
        if (c.kind === 'group') {
            if (nameEl) nameEl.textContent = c.name || 'Group chat';
            if (statusEl) statusEl.textContent = (c.participants || []).length + ' members';
            return;
        }
        if (!peer) return;

        if (nameEl) nameEl.textContent = peer.display_name || 'Conversation';
        if (statusEl) {
            statusEl.textContent = peer.is_online ? 'Online' : relativeLastSeen(peer.last_seen);
            statusEl.classList.toggle('is-online', !!peer.is_online);
        }
        if (avatarEl) {
            avatarEl.textContent = '';
            if (peer.avatar_url) {
                var img = el('img');
                img.src = peer.avatar_url;
                img.alt = '';
                avatarEl.appendChild(img);
            } else {
                avatarEl.appendChild(el('span', 'avatar__initials',
                    (peer.display_name || '??').slice(0, 2).toUpperCase()));
            }
            avatarEl.appendChild(el('span',
                'presence-dot presence-dot--' + (peer.is_online ? 'online' : 'offline')));
        }
    }

    /* ======================================================================
       WebSocket wiring (handlers bound ONCE in bindSocketHandlers)
       ====================================================================== */

    function bindSocketHandlers() {
        Socket.on('message.new', function (data) {
            var message = data.message;
            if (!message) return;
            if (message.conversation === state.conversationId) {
                if (message.sender.id !== ME) {
                    appendMessage(state.conversationId, message);
                    markReadUpTo();
                }
                updateHeader(state.conversationId);
            }
            updateConversationFromMessage(message.conversation, message);
        });

        Socket.on('message.edited', function (data) {
            var m = findMessageData(data.message_id);
            if (m) {
                m.body = data.body;
                m.edited_at = data.edited_at;
                rerenderMessage(data.message_id);
            }
        });

        Socket.on('message.deleted', function (data) {
            var m = findMessageData(data.message_id);
            if (m) {
                m.is_deleted = true;
                m.body = '';
                rerenderMessage(data.message_id);
            }
        });

        Socket.on('reaction.updated', function (data) {
            if (data.user_id === ME) return; // already applied locally
            var m = findMessageData(data.message_id);
            if (!m) return;
            m.reactions = applyReactionLocally(m.reactions, data.added, data.emoji);
            rerenderMessage(data.message_id);
        });

        Socket.on('typing.event', function (data) {
            showPeerTyping(data.display_name || 'Someone', data.is_typing);
        });

        Socket.on('read.event', function (data) {
            // A peer read our latest message — upgrade ticks to read.
            var messages = state.messages[state.conversationId] || [];
            if (data.user_id === ME) return;
            var changed = false;
            messages.forEach(function (m) {
                if (m.sender.id === ME && m.id <= data.message_id && m.state !== 'read') {
                    m.state = 'read';
                    if (m.read_by && m.read_by.indexOf(data.user_id) < 0) {
                        m.read_by.push(data.user_id);
                    }
                    changed = true;
                }
            });
            if (changed) {
                // Re-render only my bubbles whose ticks changed.
                var container = els.messages || $('messages');
                if (container) {
                    messages.forEach(function (m) {
                        if (m.sender.id === ME && m.id <= data.message_id) rerenderMessage(m.id);
                    });
                }
            }
        });

        Socket.on('presence.event', function (data) {
            var c = state.conversations[state.conversationId];
            if (!c) return;
            var peer = peerOf(c);
            if (peer && peer.id === data.user_id) {
                peer.is_online = data.is_online;
                peer.last_seen = data.last_seen;
                updateHeader(state.conversationId);
                renderConversationList();
            }
        });

        Socket.on('conversation.new', function (data) {
            updateConversationFromMessage(data.conversation_id, data.message);
        });

        Socket.on('socket.disconnected', function () {
            toast('Connection lost — reconnecting…', true);
        });

        Socket.on('socket.connected', function () {
            // Connection restored; the page state is rebuilt from REST data.
        });
    }

    /* ---------- Per-user notifications socket ---------- */

    var userSocketStarted = false;

    function startUserSocketOnce() {
        if (userSocketStarted || !Socket.connectUser) return;
        userSocketStarted = true;
        Socket.connectUser(null);
    }

    /* ---------- Typing indicator (receiver side) ---------- */

    function showPeerTyping(username, isTyping) {
        var indicator = $('typing-indicator');
        if (!indicator) return;
        var perUser = state.typingTimers;

        if (isTyping) {
            clearTimeout(perUser[username]);
            perUser[username] = setTimeout(function () {
                delete perUser[username];
                indicator.hidden = true;
            }, 3500);
        } else {
            clearTimeout(perUser[username]);
            delete perUser[username];
        }
        indicator.hidden = Object.keys(perUser).length === 0;
    }

    /* ======================================================================
       Mobile navigation & misc bindings
       ====================================================================== */

    function bindNavigation() {
        var messages = els.messages || $('messages');
        if (messages) {
            // Infinite upward scroll: fetch the older page near the top.
            messages.addEventListener('scroll', function () {
                if (messages.scrollTop < 60) loadOlderMessages();
            });
        }
        var back = $('chat-back');
        if (back) {
            back.addEventListener('click', function () {
                document.getElementById('chat-app').classList.remove('chat-app--active');
                if (window.history.replaceState) {
                    window.history.replaceState(null, '', '/');
                }
            });
        }
        var mobileBack = $('mobile-back');
        if (mobileBack) {
            mobileBack.addEventListener('click', function () {
                document.getElementById('chat-app').classList.remove('chat-app--active');
            });
        }
        var replyCancel = $('reply-cancel');
        if (replyCancel) {
            replyCancel.addEventListener('click', hideReplyPreview);
        }
        var newChat = $('new-chat-btn');
        if (newChat) {
            newChat.addEventListener('click', function () {
                var search = $('conv-search');
                if (search) search.focus();
            });
        }
        var fab = $('fab-new-chat');
        if (fab) {
            fab.addEventListener('click', function () {
                activateTab('chats');
                var search = $('conv-search');
                if (search) search.focus();
            });
        }
    }

    /* ======================================================================
       New group modal — pick members from people you've chatted with
       ====================================================================== */

    var groupPicker = { open: false, people: [], selected: {} };

    function chatPeopleUrl() { return '/api/chats/people/'; }

    function selectedCount() {
        return Object.keys(groupPicker.selected).length;
    }

    function renderGroupPeople(query) {
        var list = $('group-people-list');
        if (!list) return;
        list.textContent = '';

        var q = (query || '').trim().toLowerCase();
        var people = groupPicker.people.filter(function (p) {
            if (!q) return true;
            var name = (p.display_name || '').toLowerCase();
            var phone = (p.masked_phone || '').toLowerCase();
            return name.indexOf(q) !== -1 || phone.indexOf(q) !== -1;
        });

        var emptyNote = $('group-people-empty');
        if (emptyNote) emptyNote.hidden = people.length > 0;

        people.forEach(function (p) {
            var isSelected = !!groupPicker.selected[p.id];
            var li = el('li', 'group-person' + (isSelected ? ' is-selected' : ''));
            li.setAttribute('role', 'checkbox');
            li.setAttribute('aria-checked', isSelected ? 'true' : 'false');
            li.setAttribute('tabindex', '0');

            var avatar = el('div', 'avatar avatar--sm');
            if (p.avatar_url) {
                var img = el('img');
                img.src = p.avatar_url;
                img.alt = '';
                avatar.appendChild(img);
            } else {
                avatar.appendChild(el('span', 'avatar__initials',
                    (p.display_name || '??').slice(0, 2).toUpperCase()));
            }

            var body = el('div', 'group-person__body');
            body.appendChild(el('span', 'group-person__name', p.display_name || 'Unknown'));
            body.appendChild(el('span', 'group-person__phone', p.masked_phone || ''));

            var check = el('span', 'group-person__check', isSelected ? '✓' : '');

            li.appendChild(avatar);
            li.appendChild(body);
            li.appendChild(check);

            function toggle() {
                if (groupPicker.selected[p.id]) {
                    delete groupPicker.selected[p.id];
                } else {
                    groupPicker.selected[p.id] = true;
                }
                renderGroupPeople($('group-people-search') ? $('group-people-search').value : '');
                updateGroupButtons();
            }
            li.addEventListener('click', toggle);
            li.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
            });
            list.appendChild(li);
        });
    }

    function updateGroupButtons() {
        var count = selectedCount();
        var countLabel = $('group-selected-count');
        if (countLabel) {
            countLabel.textContent = count === 0
                ? 'Pick people to add'
                : count + (count === 1 ? ' person selected' : ' people selected');
        }
        var create = $('group-create-btn');
        if (create) create.disabled = count === 0;
    }

    function openGroupModal() {
        var modal = $('group-modal');
        if (!modal) return;
        groupPicker = { open: true, people: [], selected: {} };
        var search = $('group-people-search');
        if (search) search.value = '';
        updateGroupButtons();
        renderGroupPeople('');
        modal.hidden = false;
        if (search) search.focus();

        API.get(chatPeopleUrl()).then(function (data) {
            if (!groupPicker.open) return;
            groupPicker.people = (data && data.results) || [];
            renderGroupPeople(search ? search.value : '');
        }).catch(function (err) {
            toast('Could not load your chats: ' + err.message, true);
        });
    }

    function closeGroupModal() {
        var modal = $('group-modal');
        if (modal) modal.hidden = true;
        groupPicker.open = false;
    }

    function submitGroup() {
        var nameInput = $('group-name-input');
        var name = nameInput ? nameInput.value.trim() : '';
        var userIds = Object.keys(groupPicker.selected).map(Number);

        if (!name) {
            toast('Give the group a name first.', true);
            if (nameInput) nameInput.focus();
            return;
        }
        if (!userIds.length) return;

        var create = $('group-create-btn');
        if (create) create.disabled = true;

        API.post('/api/groups/', { name: name, user_ids: userIds })
            .then(function (group) {
                closeGroupModal();
                state.conversations[group.id] = {
                    id: group.id,
                    kind: 'group',
                    name: group.name,
                    participants: group.participants || [],
                    last_message: null,
                    unread_count: 0,
                    updated_at: new Date().toISOString(),
                };
                renderConversationList();
                openConversation(group.id, true);
            })
            .catch(function (err) {
                toast('Could not create group: ' + err.message, true);
                updateGroupButtons();
            });
    }

    function bindGroupModal() {
        var newGroup = $('new-group-btn');
        if (newGroup) newGroup.addEventListener('click', openGroupModal);

        var closeBtn = $('group-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', closeGroupModal);

        var cancel = $('group-cancel-btn');
        if (cancel) cancel.addEventListener('click', closeGroupModal);

        var create = $('group-create-btn');
        if (create) create.addEventListener('click', submitGroup);

        var search = $('group-people-search');
        if (search) {
            search.addEventListener('input', function () {
                renderGroupPeople(search.value);
            });
        }

        var modal = $('group-modal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeGroupModal();
            });
            modal.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeGroupModal();
            });
        }
    }

    function createGroup() {
        openGroupModal();
    }

    /* ======================================================================
       Sidebar tabs & WhatsApp filter chips
       ====================================================================== */

    function bindTabs() {
        var chips = document.querySelectorAll('#wa-filters .wa-chip');
        chips.forEach(function (chip) {
            chip.addEventListener('click', function () {
                var f = chip.getAttribute('data-filter') || 'all';
                state.filter = f;
                chips.forEach(function (c) {
                    var isSel = c === chip;
                    c.classList.toggle('is-active', isSel);
                    c.setAttribute('aria-selected', isSel ? 'true' : 'false');
                });
                renderConversationList();
            });
        });

        var railBtns = document.querySelectorAll('.rail__btn[data-rail]');
        railBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = btn.getAttribute('data-rail');
                railBtns.forEach(function (b) {
                    b.classList.toggle('is-active', b === btn);
                });
                if (target === 'groups') {
                    activateTab('groups');
                } else if (target === 'friends') {
                    activateTab('friends');
                } else {
                    activateTab('chats');
                }
            });
        });

        var notifications = $('rail-notifications');
        if (notifications) {
            notifications.addEventListener('click', function () {
                API.get('/api/notifications/').then(function (data) {
                    var items = (data && (data.results || data)) || [];
                    if (!items.length) {
                        toast('You\'re all caught up — no new notifications.');
                        return;
                    }
                    toast(items.length + ' recent notification' +
                        (items.length === 1 ? '' : 's') + '. Latest: ' +
                        (items[0].kind || 'update'));
                }).catch(function () {
                    toast('Could not load notifications.', true);
                });
            });
        }
    }

    function activateTab(name) {
        state.activeTab = name || 'chats';
        document.querySelectorAll('.sidebar__section[data-panel]').forEach(function (panel) {
            panel.hidden = panel.getAttribute('data-panel') !== state.activeTab;
        });
        var searchResults = $('search-results');
        if (searchResults) searchResults.hidden = state.activeTab !== 'chats';

        if (state.activeTab === 'friends' && !state.contactsLoaded) {
            loadContacts();
        }
    }

    /* ---------- Friends (saved contacts) ---------- */

    function loadContacts() {
        var loading = $('friends-loading');
        if (loading) loading.hidden = false;
        return API.get('/api/contacts/').then(function (data) {
            state.contacts = {};
            ((data && data.results) || []).forEach(function (contact) {
                state.contacts[contact.contact_id] = contact;
            });
            state.contactsLoaded = true;
            renderContacts();
        }).catch(function (err) {
            toast('Could not load friends: ' + err.message, true);
        }).then(function () {
            if (loading) loading.hidden = true;
        });
    }

    function renderContacts() {
        var list = $('contacts-list');
        if (!list) return;
        list.textContent = '';

        var people = Object.values(state.contacts).sort(function (a, b) {
            var an = (a.display_name || '').toLowerCase();
            var bn = (b.display_name || '').toLowerCase();
            return an < bn ? -1 : an > bn ? 1 : 0;
        });

        var empty = $('friends-empty');
        if (empty) empty.hidden = people.length > 0;

        people.forEach(function (contact) {
            var userId = contact.contact_id;
            var name = contact.nickname || contact.display_name || 'Unknown';

            var li = el('li', 'conv-item');
            li.setAttribute('role', 'button');
            li.setAttribute('tabindex', '0');

            var avatar = el('div', 'avatar avatar--sm');
            if (contact.avatar_url) {
                var img = el('img');
                img.src = contact.avatar_url;
                img.alt = '';
                avatar.appendChild(img);
            } else {
                avatar.appendChild(el('span', 'avatar__initials', name.slice(0, 2).toUpperCase()));
            }

            var body = el('div', 'conv-item__body');
            var nameRow = el('div', 'conv-item__name');
            nameRow.appendChild(el('span', null, name));
            body.appendChild(nameRow);

            var chatBtn = el('button', 'icon-btn conv-item__star', '💬');
            chatBtn.type = 'button';
            chatBtn.title = 'Open chat';
            chatBtn.setAttribute('aria-label', 'Open chat with ' + name);
            chatBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                startChatWith(userId, name);
            });

            var removeBtn = el('button', 'icon-btn conv-item__star', '✕');
            removeBtn.type = 'button';
            removeBtn.title = 'Remove from friends';
            removeBtn.setAttribute('aria-label', 'Remove ' + name + ' from friends');
            removeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                removeContact(userId);
            });

            li.appendChild(avatar);
            li.appendChild(body);
            li.appendChild(chatBtn);
            li.appendChild(removeBtn);

            function open() { startChatWith(userId, name); }
            li.addEventListener('click', open);
            li.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
            list.appendChild(li);
        });
    }

    function startChatWith(userId, name) {
        API.post('/api/conversations/start/', { user_id: userId })
            .then(function (conversation) {
                state.conversations[conversation.id] = conversation;
                renderConversationList();
                activateTab('chats');
                openConversation(conversation.id, true);
            })
            .catch(function (err) {
                toast('Could not open chat with ' + (name || 'user') + ': ' + err.message, true);
            });
    }

    function addContact(user) {
        return API.post('/api/contacts/', { user_id: user.id }).then(function (contact) {
            state.contacts[user.id] = contact;
            renderContacts();
            toast('Added ' + (user.display_name || 'friend') + ' to your friends.');
        }).catch(function (err) {
            toast('Could not add friend: ' + err.message, true);
        });
    }

    function removeContact(userId) {
        return API.delete('/api/contacts/' + userId + '/').then(function () {
            delete state.contacts[userId];
            renderContacts();
        }).catch(function (err) {
            toast('Could not remove friend: ' + err.message, true);
        });
    }

    /* ---------- Group info modal ---------- */

    function bindGroupInfo() {
        var infoBtn = $('chat-info-btn');
        if (infoBtn) {
            infoBtn.addEventListener('click', function () {
                openGroupInfo(state.conversationId);
            });
        }
        var closeBtn = $('group-info-close');
        if (closeBtn) closeBtn.addEventListener('click', closeGroupInfo);
        var doneBtn = $('group-info-done');
        if (doneBtn) doneBtn.addEventListener('click', closeGroupInfo);
        var leaveBtn = $('group-info-leave');
        if (leaveBtn) {
            leaveBtn.addEventListener('click', function () {
                if (!window.confirm('Leave this group?')) return;
                var conversationId = state.conversationId;
                API.post('/api/groups/' + conversationId + '/leave/')
                    .then(function () {
                        closeGroupInfo();
                        Socket.close();
                        delete state.conversations[conversationId];
                        renderConversationList();
                        state.conversationId = null;
                        var container = els.messages || $('messages');
                        if (container) container.textContent = '';
                        if (window.history.replaceState) {
                            window.history.replaceState(null, '', '/');
                        }
                        document.getElementById('chat-app').classList.remove('chat-app--active');
                        toast('You left the group.');
                    })
                    .catch(function (err) {
                        toast('Could not leave group: ' + err.message, true);
                    });
            });
        }
        var modal = $('group-info-modal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeGroupInfo();
            });
            modal.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeGroupInfo();
            });
        }
    }

    function openGroupInfo(conversationId) {
        var modal = $('group-info-modal');
        if (!modal || !conversationId) return;
        modal.hidden = false;
        var members = $('group-info-members');
        if (members) {
            members.textContent = '';
            members.appendChild(el('li', 'sidebar__empty', 'Loading…'));
        }
        API.get('/api/groups/' + conversationId + '/').then(function (group) {
            var nameEl = $('group-info-name');
            var descEl = $('group-info-desc');
            var avatarEl = $('group-info-avatar');
            if (nameEl) nameEl.textContent = group.name || 'Group chat';
            if (descEl) descEl.textContent = group.description || '';
            if (avatarEl) {
                avatarEl.textContent = '';
                avatarEl.appendChild(el('span', 'avatar__initials',
                    (group.name || 'Group').slice(0, 2).toUpperCase()));
            }
            var membersTitle = $('group-info-members-title');
            if (membersTitle) {
                membersTitle.textContent = 'Members (' + (group.participants || []).length + ')';
            }
            if (members) {
                members.textContent = '';
                (group.participants || []).forEach(function (member) {
                    var li = el('li', 'group-person group-person--static');
                    var avatar = el('div', 'avatar avatar--sm');
                    if (member.avatar_url) {
                        var img = el('img');
                        img.src = member.avatar_url;
                        img.alt = '';
                        avatar.appendChild(img);
                    } else {
                        avatar.appendChild(el('span', 'avatar__initials',
                            (member.display_name || '??').slice(0, 2).toUpperCase()));
                    }
                    var body = el('div', 'group-person__body');
                    body.appendChild(el('span', 'group-person__name', member.display_name || 'Unknown'));
                    li.appendChild(avatar);
                    li.appendChild(body);
                    if (member.is_admin) li.appendChild(el('span', 'group-person__role', 'Admin'));
                    if (member.id === ME) li.appendChild(el('span', 'group-person__role', 'You'));
                    members.appendChild(li);
                });
            }
            // Refresh sidebar/header with any updated group details.
            var c = state.conversations[conversationId];
            if (c) {
                c.name = group.name;
                c.participants = group.participants;
                renderConversationList();
                updateHeader(conversationId);
            }
        }).catch(function (err) {
            closeGroupInfo();
            toast('Could not load group info: ' + err.message, true);
        });
    }

    function closeGroupInfo() {
        var modal = $('group-info-modal');
        if (modal) modal.hidden = true;
    }

    /* ======================================================================
       Init
       ====================================================================== */

    function init() {
        els.messages = $('messages');
        bindSearch();
        bindComposer();
        bindNavigation();
        bindGroupModal();
        bindTabs();
        bindGroupInfo();
        bindSocketHandlers();
        loadContacts();

        startUserSocketOnce();
        loadConversations();

        if (state.conversationId) {
            var c = state.conversations[state.conversationId];
            openConversation(state.conversationId, false);
            if (!c) {
                // Reloaded directly onto a chat URL: fetch its list entry.
                API.get('/api/conversations/').then(function (data) {
                    (data || []).forEach(function (conv) {
                        state.conversations[conv.id] = conv;
                    });
                    renderConversationList();
                    updateHeader(state.conversationId);
                });
            }
        } else {
            // Conversations page: periodic refresh keeps unread badges fresh
            // alongside the notifications socket.
            setInterval(loadConversations, 20000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
