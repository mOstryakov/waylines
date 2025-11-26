from django.urls import path
from . import views

app_name = 'interactions'

urlpatterns = [
    path('favorite/<int:route_id>/', views.toggle_favorite, name='toggle_favorite'),
    path('rating/<int:route_id>/', views.add_rating, name='add_rating'),
    path('comment/<int:route_id>/', views.add_comment, name='add_comment'),
    path('comment/delete/<int:comment_id>/', views.delete_comment, name='delete_comment'),
    path('my-favorites/', views.my_favorites, name='my_favorites'),
]
