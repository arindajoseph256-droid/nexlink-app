"""Health check for load balancers and uptime monitors."""
from django.db import connection
from django.http import JsonResponse


def health(request):
    """Return 200 while the app and its database answer; never requires auth."""
    db_ok = True
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
    except Exception:
        db_ok = False
    return JsonResponse({'status': 'ok' if db_ok else 'degraded', 'db': db_ok})
