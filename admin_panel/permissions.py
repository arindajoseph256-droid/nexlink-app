"""Permission classes: one thin DRF wrapper over admin_panel.models.has_caps."""
from rest_framework.permissions import BasePermission


class CapabilityPermission(BasePermission):
    """Deny by default; require the scopes configured on the instance.

    Instantiated via the :func:`caps` factory, which DRF sees as a normal
    permission *class* (DRF instantiates permission classes itself).
    """

    required_scopes = ('dashboard',)

    def has_permission(self, request, view):
        from .models import has_caps
        return has_caps(request.user, *self.required_scopes)


def caps(*scopes):
    """Permission-class factory: ``permission_classes=[caps('users.view')]``."""
    scope_tuple = tuple(scopes) or ('dashboard',)
    return type('CapabilityPermission_' + '_'.join(scope_tuple), (CapabilityPermission,), {
        'required_scopes': scope_tuple,
    })
