import json

from channels.generic.websocket import AsyncWebsocketConsumer


class TestConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        print("✅ TEST WebSocket подключен! Routing работает!")
        await self.accept()
        await self.send(text_data=json.dumps({
            'type': 'test',
            'message': 'WebSocket работает!'
        }))

    async def receive(self, text_data):
        print("📨 Получено сообщение:", text_data)

    async def disconnect(self, close_code):
        print("❌ TEST WebSocket отключен")


websocket_urlpatterns = [
    re_path(
        r"ws/private_chat/(?P<conversation_id>\w+)/$",
        consumers.PrivateChatConsumer.as_asgi(),
    ),
    re_path(
        r"ws/route_chat/(?P<route_id>\w+)/$",
        consumers.RouteChatConsumer.as_asgi(),
    ),
]
