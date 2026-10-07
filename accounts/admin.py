"""Admin registration for accounts."""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import AdminWarning, Profile, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ('phone_number', 'username', 'first_name', 'email',
                    'is_staff', 'is_active', 'date_joined')
    list_filter = ('is_staff', 'is_active')
    search_fields = ('phone_number', 'username', 'first_name', 'email')
    ordering = ('-date_joined',)
    fieldsets = (
        (None, {'fields': ('phone_number', 'username', 'password')}),
        ('Personal info', {'fields': ('first_name', 'last_name', 'email')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser',
                                    'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('phone_number', 'username', 'password1', 'password2'),
        }),
    )


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'display_name', 'is_online', 'last_seen')
    search_fields = ('user__phone_number', 'user__username', 'display_name')
    list_filter = ('is_online',)


@admin.register(AdminWarning)
class AdminWarningAdmin(admin.ModelAdmin):
    list_display = ('recipient', 'issued_by', 'reason', 'is_read', 'created_at')
    search_fields = ('recipient__phone_number', 'recipient__username', 'reason')
    list_filter = ('is_read',)
