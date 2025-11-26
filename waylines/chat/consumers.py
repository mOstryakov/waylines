import json
import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from .models import Conversation, PrivateMessage, RouteChat, RouteChatMessage
from routes.models import Route
from django.utils import timezone


class PrivateChatConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.conversation_id = None
        self.user = None
        self.room_group_name = None

    async def connect(self):
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        self.user = self.scope["user"]
        
        if self.user == AnonymousUser():
            await self.close()
            return
            
        # Проверяем доступ к беседе
        if not await self.is_participant():
            await self.close()
            return
            
        self.room_group_name = f'private_chat_{self.conversation_id}'
        
        # Присоединяемся к группе
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        await self.accept()
        
        # Отправляем историю сообщений
        await self.send_history()
        
        # Уведомляем о подключении
        await self.notify_user_online()

    async def disconnect(self, close_code):
        # Уведомляем об отключении
        await self.notify_user_offline()
        
        # Покидаем группу
        if self.room_group_name:
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message_type = text_data_json.get('type', 'chat_message')
            
            if message_type == 'chat_message':
                await self.handle_chat_message(text_data_json)
            elif message_type == 'user_typing':
                await self.handle_typing(text_data_json, True)
            elif message_type == 'user_stop_typing':
                await self.handle_typing(text_data_json, False)
            elif message_type == 'get_history':
                await self.send_history()
            elif message_type == 'ping':
                await self.handle_ping()
                
        except json.JSONDecodeError:
            await self.send_error("Invalid JSON")
        except Exception as e:
            await self.send_error(str(e))

    async def handle_chat_message(self, data):
        message = data.get('message', '').strip()
        user_id = data.get('user_id')
        
        if not message or len(message) > 1000:
            await self.send_error("Invalid message")
            return
            
        # Сохраняем сообщение в БД
        message_obj = await self.save_message(message)
        
        # Отправляем сообщение в группу
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message_obj.content,
                'user_id': message_obj.sender.id,
                'username': message_obj.sender.username,
                'message_id': message_obj.id,
                'timestamp': message_obj.created_at.strftime('%H:%M'),
            }
        )

    async def handle_typing(self, data, is_typing):
        user_id = data.get('user_id')
        username = data.get('username')
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_typing' if is_typing else 'user_stop_typing',
                'user_id': user_id,
                'username': username,
            }
        )

    async def handle_ping(self):
        # Ответ на пинг для поддержания соединения
        await self.send(text_data=json.dumps({
            'type': 'pong'
        }))

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
            'user_id': event['user_id'],
            'username': event['username'],
            'message_id': event['message_id'],
            'timestamp': event['timestamp'],
        }))

    async def user_typing(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_typing',
            'user_id': event['user_id'],
            'username': event['username'],
        }))

    async def user_stop_typing(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_stop_typing',
            'user_id': event['user_id'],
        }))

    async def send_history(self):
        messages = await self.get_message_history()
        await self.send(text_data=json.dumps({
            'type': 'history',
            'messages': messages
        }))

    async def send_error(self, error_message):
        await self.send(text_data=json.dumps({
            'type': 'error',
            'error': error_message
        }))

    async def notify_user_online(self):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_online',
                'user_id': self.user.id,
                'username': self.user.username,
            }
        )

    async def notify_user_offline(self):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_offline',
                'user_id': self.user.id,
                'username': self.user.username,
            }
        )

    @database_sync_to_async
    def is_participant(self):
        return Conversation.objects.filter(
            id=self.conversation_id, 
            participants=self.user
        ).exists()

    @database_sync_to_async
    def save_message(self, message_content):
        conversation = Conversation.objects.get(id=self.conversation_id)
        message = PrivateMessage.objects.create(
            conversation=conversation,
            sender=self.user,
            content=message_content
        )
        # Обновляем время беседы
        conversation.updated_at = timezone.now()
        conversation.save()
        return message

    @database_sync_to_async
    def get_message_history(self):
        conversation = Conversation.objects.get(id=self.conversation_id)
        messages = conversation.messages.all().order_by('-created_at')[:50]
        return [
            {
                'id': msg.id,
                'content': msg.content,
                'sender': msg.sender.username,
                'sender_id': msg.sender.id,
                'created_at': msg.created_at.strftime('%H:%M'),
            }
            for msg in reversed(messages)  # Переворачиваем чтобы старые были первыми
        ]


class RouteChatConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.route_id = None
        self.user = None
        self.room_group_name = None

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
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message_type = text_data_json.get('type', 'chat_message')
            
            if message_type == 'chat_message':
                await self.handle_route_chat_message(text_data_json)
            elif message_type == 'user_typing':
                await self.handle_typing(text_data_json, True)
            elif message_type == 'user_stop_typing':
                await self.handle_typing(text_data_json, False)
            elif message_type == 'get_history':
                await self.send_history()
            elif message_type == 'ping':
                await self.handle_ping()
                
        except json.JSONDecodeError:
            await self.send_error("Invalid JSON")
        except Exception as e:
            await self.send_error(str(e))

    async def handle_route_chat_message(self, data):
        message = data.get('message', '').strip()
        user_id = data.get('user_id')
        
        if not message or len(message) > 1000:
            await self.send_error("Invalid message")
            return
            
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
            }
        )

    async def handle_typing(self, data, is_typing):
        user_id = data.get('user_id')
        username = data.get('username')
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_typing' if is_typing else 'user_stop_typing',
                'user_id': user_id,
                'username': username,
            }
        )

    async def handle_ping(self):
        await self.send(text_data=json.dumps({
            'type': 'pong'
        }))

    async def route_chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'route_chat_message',
            'message': event['message'],
            'user_id': event['user_id'],
            'username': event['username'],
            'message_id': event['message_id'],
            'timestamp': event['timestamp'],
        }))

    async def user_typing(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_typing',
            'user_id': event['user_id'],
            'username': event['username'],
        }))

    async def user_stop_typing(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_stop_typing',
            'user_id': event['user_id'],
        }))

    async def send_history(self):
        messages = await self.get_message_history()
        await self.send(text_data=json.dumps({
            'type': 'history',
            'messages': messages
        }))

    async def send_error(self, error_message):
        await self.send(text_data=json.dumps({
            'type': 'error',
            'error': error_message
        }))

    @database_sync_to_async
    def can_access_route(self):
        try:
            route = Route.objects.get(id=self.route_id)
            
            # Проверяем доступ к маршруту
            if route.privacy == 'public':
                return True
            elif route.privacy == 'personal':
                return route.author == self.user or self.user in route.shared_with.all()
            else:  # private
                return route.author == self.user
        except Route.DoesNotExist:
            return False

    @database_sync_to_async
    def save_message(self, message_content):
        route_chat, created = RouteChat.objects.get_or_create(route_id=self.route_id)
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
        try:
            route_chat = RouteChat.objects.get(route_id=self.route_id)
            messages = route_chat.messages.all().order_by('-timestamp')[:50]
            return [
                {
                    'id': msg.id,
                    'content': msg.message,
                    'sender': msg.user.username,
                    'sender_id': msg.user.id,
                    'created_at': msg.timestamp.strftime('%H:%M'),
                }
                for msg in reversed(messages)  # Переворачиваем чтобы старые были первыми
            ]
        except RouteChat.DoesNotExist:
            return []