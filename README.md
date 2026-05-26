# Weather-App

weather-app/
│
├── backend/                    ← Node.js/Express server
│   ├── index.js               ← Main server + all API routes
│   ├── weather_app.db         ← SQLite database (auto-generated)
│   ├── package.json           ← Backend dependencies
│   ├── package-lock.json
│   └── _env                   ← Environment variables (rename to .env)
│
└── frontend/                   ← Static files served by Express
    ├── index.html             ← Redirects / landing (or legacy)
    ├── dashboard.html         ← Main weather dashboard
    ├── auth.html              ← Login & Signup page
    ├── verify-email.html      ← OTP verification page
    ├── profile.html           ← User profile & settings
    ├── admin.html             ← Admin panel (role-gated)
    ├── style.css              ← Global stylesheet
    ├── script.js              ← Dashboard logic (weather, map, city info)
    ├── auth-check.js          ← Auth guard (runs on every protected page)
    └── CITY_INFO_SETUP.md     ← Setup/feature documentation
