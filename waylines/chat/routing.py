from django.urls import re_path
from . import consumers


websocket_urlpatterns = [
    re_path(r'ws/private_chat/(?P<conversation_id>\w+)/$', consumers.PrivateChatConsumer.as_asgi()),
    re_path(r'ws/route_chat/(?P<route_id>\w+)/$', consumers.RouteChatConsumer.as_asgi()),
]