from django.urls import path
from . import consumers_websocket

# Эти URL будут обрабатываться Django, но перенаправляться в ASGI
urlpatterns = [
    path('', consumers_websocket.websocket_view, name='private_chat_websocket'),
]
