# Petition setup (one time, ~10 minutes)

The petition form needs somewhere to save signatures. We use a free Firebase database
(Google). Until you finish these steps the petition banner stays hidden on the website.

1. Go to https://console.firebase.google.com → **Add project** (name e.g. `bmet-petition`, turn Google Analytics off).
2. **Build → Firestore Database → Create database** → *Production mode* → location **eur3 / europe-west2 (London)**.
3. **Build → Authentication → Get started → Email/Password → Enable → Save.**
   Then the **Users** tab → **Add user** → your email + the password you want to use for the admin page. On the admin page you only type that password (the email comes from `petition-config.js`).
4. **Firestore → Rules** → replace everything with the rules below (put YOUR admin email) → **Publish**.
5. **Project settings (gear) → General → Your apps → Web app (`</>`)** → register an app → copy `apiKey` and use the Project ID.
6. Edit `petition-config.js` in the repo:
   ```js
   window.PETITION_CONFIG = { projectId: 'bmet-petition', apiKey: 'AIza...', adminEmail: 'you@example.com' };
   ```
7. Open `https://20rajonadil.github.io/BMet-Prayer-web/petition-admin.html`, sign in, download the PDF.

## Firestore rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /petition/{id} {
      // Anyone can ADD one signature (doc id = student ID, so one per student). Nobody can read/edit/delete except you.
      allow create: if request.resource.data.keys().hasAll(['fullName','studentId','course','year','date','signature','createdAt'])
        && request.resource.data.keys().hasOnly(['fullName','studentId','course','year','date','signature','createdAt'])
        && request.resource.data.fullName is string && request.resource.data.fullName.size() >= 3 && request.resource.data.fullName.size() <= 80
        && request.resource.data.studentId is string && request.resource.data.studentId.size() >= 4 && request.resource.data.studentId.size() <= 20
        && id == request.resource.data.studentId
        && request.resource.data.course is string && request.resource.data.course.size() >= 2 && request.resource.data.course.size() <= 80
        && request.resource.data.year is string && request.resource.data.year.size() <= 20
        && request.resource.data.date is string && request.resource.data.date.size() <= 10
        && request.resource.data.createdAt is string && request.resource.data.createdAt.size() <= 40
        && request.resource.data.signature is string && request.resource.data.signature.size() > 200 && request.resource.data.signature.size() < 200000;
      allow read, update, delete: if request.auth != null && request.auth.token.email == 'YOUR_ADMIN_EMAIL_HERE';
    }
  }
}
```
