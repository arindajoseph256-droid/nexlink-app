"""Admin web pages (/admin-panel/) — server-rendered shell + JS app."""
from django.contrib.auth import get_user_model
from django.contrib.auth.views import redirect_to_login
from django.http import HttpResponseForbidden
from django.shortcuts import render, reverse
from functools import wraps

from .models import has_caps

User = get_user_model()


def admin_page_required(view):
    """Anonymous → login; signed-in without admin caps → branded 403."""
    @wraps(view)
    def _wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect_to_login(request.get_full_path(), login_url=reverse('accounts:login'))
        if not has_caps(request.user, 'dashboard'):
            return HttpResponseForbidden('Administrator access required.')
        return view(request, *args, **kwargs)
    return _wrapped


@admin_page_required
def admin_home(request):
    """Single-page admin shell: all sections render via /api/admin/*."""
    return render(request, 'admin_panel/dashboard.html', {
        'seo_noindex': True,
    })
