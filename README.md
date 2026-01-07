# Waylines: Platform for Author Routes

A web application for creating, sharing, and discovering custom routes with AI-generated audio guides.

## Features
- User authentication and friendship system
- Route creation with interactive maps
- AI-generated audio guides (Yandex GPT + SpeechKit)
- Real-time chats for routes and users
- Multilingual support (EN, ES, DE, FR, RU)
- Search and filtering system
- Mobile-responsive design

## Local Development Setup  

### 1. Clone repository

```bash
git clone https://github.com/mOstryakov/waylines.git
cd waylines
```

### 2. Create virtual environment

Linux/MacOS: 
```bash
python3 -m venv venv
```

Windows:
```bash
python -m venv venv
```  

### 3. Activate virtual environment

Linux/MacOS: 
```bash
source venv/bin/activate
```  
Windows:
 ```bash
venv\Scripts\activate
```  

### 4. Installing dependencies

For production: 
```bash
pip install -r requirements/prod.txt
```  
For testing:
 ```bash
pip install -r requirements/test.txt
```  
For development: 
```bash
pip install -r requirements/dev.txt
``` 

### 5. Configure environment variables

Copy the example environment file and fill in your API keys:
```bash
cp .env.example .env
```

### 6. Apply database migrations

#### Apply migrations to database

```bash
python manage.py migrate
```

#### Create a superuser (for access to the admin panel)

```bash
python manage.py createsuperuser
```

#### Collect static files (required for admin panel and styling)  

```bash
python manage.py collectstatic --noinput
```

#### Check migration status

```bash
python manage.py showmigrations
```

### 7. Running tests

```bash
python manage.py test
```

### 8. Run development server:

```bash
python manage.py runserver
```
Available at http://127.0.0.1:8000

## API Keys Required

#### Yandex Cloud API
Go to Yandex Cloud Console  
Create API key in your folder  
Add to ```YANDEX_API_KEY``` in ```.env```  

#### OpenRouteService API  
Sign up at OpenRouteService  
Get API key from dashboard  
Add to ```OPENROUTESERVICE_API_KEY``` in ```.env```  

## Built With
- **Backend**: Python, Django
- **Database**: SQLite
- **Frontend**: HTML, CSS, JavaScript
- **APIs**: Yandex GPT, Yandex SpeechKit, OpenRouteService
- **DevOps**: GitLab CI, flake8, black, Django test client