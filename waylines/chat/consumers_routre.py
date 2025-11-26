import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from .models import RouteChat, RouteChatMessage
from routes.models import Route
from django.utils import timezone

class RouteChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.route_id = self.scope['url_route']['kwargs']['route_id']
        self.user = self.scope["user"]
        
        if self.user == AnonymousUser():
            await self.close()
            return
            
        # Проверяем доступ к маршруту
        if not await self.can_access_route():
            await self.close()
            return
            
        self.room_group_name = f'route_chat_{self.route_id}'
        
        # Присоединяемся к группе
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        await self.accept()
        await self.send_history()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        data = json.loads(text_data)
        message = data['message']
        user_id = data['user_id']
        
        # Сохраняем сообщение в БД
        message_obj = await self.save_message(message)
        
        # Отправляем сообщение в группу
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'route_chat_message',
                'message': message_obj.message,
                'user_id': message_obj.user.id,
                'username': message_obj.user.username,
                'message_id': message_obj.id,
                'timestamp': message_obj.timestamp.strftime('%H:%M'),
                'route_id': self.route_id,
            }
        )

    async def route_chat_message(self, event):
        await self.send(text_data=json.dumps({
            'message': event['message'],
            'user_id': event['user_id'],
            'username': event['username'],
            'message_id': event['message_id'],
            'timestamp': event['timestamp'],
            'route_id': event['route_id'],
            'type': 'route_chat_message'
        }))

    @database_sync_to_async
    def can_access_route(self):
        from routes.views import can_view_route
        route = Route.objects.get(id=self.route_id)
        return can_view_route(self.user, route)

    @database_sync_to_async
    def save_message(self, message_content):
        route_chat = RouteChat.objects.get(route_id=self.route_id)
        message = RouteChatMessage.objects.create(
            route_chat=route_chat,
            user=self.user,
            message=message_content
        )
        # Обновляем время чата
        route_chat.updated_at = timezone.now()
        route_chat.save()
        return message

    @database_sync_to_async
    def get_message_history(self):
        route_chat = RouteChat.objects.get(route_id=self.route_id)
        messages = route_chat.messages.all().order_by('timestamp')[:50]
        return [
            {
                'id': msg.id,
                'content': msg.message,
                'sender': msg.user.username,
                'sender_id': msg.user.id,
                'created_at': msg.timestamp.strftime('%H:%M'),
            }
            for msg in messages
        ]

    async def send_history(self):
        messages = await self.get_message_history()
        await self.send(text_data=json.dumps({
            'type': 'history',
            'messages': messages
        }))
