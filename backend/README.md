# Picking Up Backend

Django REST backend for the Picking Up task app.

## Stack

- Django
- Django REST Framework
- Simple JWT
- PostgreSQL for production
- SQLite for local development by default

## Setup

```text
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
.\.venv\Scripts\python.exe manage.py migrate
```

## Run

```text
.\.venv\Scripts\python.exe manage.py runserver
```

## Auth Endpoints

```text
POST /api/auth/register/
POST /api/auth/token/
POST /api/auth/token/refresh/
GET  /api/auth/me/
```

## Tests

```text
.\.venv\Scripts\python.exe manage.py test apps.accounts
```
