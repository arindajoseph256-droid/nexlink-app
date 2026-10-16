"""URL patterns for the admin API (mounted at /api/admin/ in config.urls.py)."""
from django.urls import path

from . import views

app_name = 'admin_api'

urlpatterns = [
    path('me/', views.current_role_view, name='me'),
    path('dashboard/', views.dashboard_stats, name='dashboard'),
    # Users
    path('users/', views.users_list, name='users'),
    path('users/export/', views.users_export, name='users_export'),
    path('users/<int:user_id>/', views.user_detail, name='user_detail'),
    path('users/<int:user_id>/edit/', views.user_edit, name='user_edit'),
    path('users/<int:user_id>/warn/', views.user_warn, name='user_warn'),
    path('users/<int:user_id>/suspend/', views.user_suspend, name='user_suspend'),
    path('users/<int:user_id>/reactivate/', views.user_reactivate, name='user_reactivate'),
    path('users/<int:user_id>/delete/', views.user_delete, name='user_delete'),
    # Reports & moderation cases
    path('reports/', views.reports_list, name='reports'),
    path('reports/<int:report_id>/assign/', views.report_assign, name='report_assign'),
    path('reports/<int:report_id>/resolve/', views.report_resolve, name='report_resolve'),
    path('reports/<int:report_id>/messages/', views.report_messages, name='report_messages'),
    # Groups
    path('groups/', views.groups_list, name='groups'),
    path('groups/<int:group_id>/', views.group_detail, name='group_detail'),
    path('groups/<int:group_id>/archive/', views.group_archive, name='group_archive'),
    path('groups/<int:group_id>/unarchive/', views.group_unarchive, name='group_unarchive'),
    path('groups/<int:group_id>/members/<int:user_id>/remove/', views.group_remove_member, name='group_remove_member'),
    # Announcements
    path('announcements/', views.announcements, name='announcements'),
    path('announcements/<int:announcement_id>/send/', views.announcement_send, name='announcement_send'),
    # Administrators & role rules
    path('administrators/', views.administrators_list, name='administrators'),
    path('administrators/<int:user_id>/role/', views.administrator_role_change, name='administrator_role'),
    path('administrators/<int:user_id>/deactivate/', views.administrator_deactivate, name='administrator_deactivate'),
    # Audit & health & settings
    path('audit-logs/', views.audit_logs, name='audit_logs'),
    path('health/', views.health_full, name='health'),
    path('settings/', views.settings_view, name='settings'),
    path('settings/update/', views.settings_update, name='settings_update'),
]
