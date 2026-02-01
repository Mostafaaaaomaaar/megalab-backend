# تشغيل Backend API للإشعارات
# Running the Notification Backend API

## المتطلبات | Requirements

```bash
npm install express cors firebase-admin
```

## التشغيل | Running

```bash
# تعيين المتغيرات البيئية
export API_KEY=your-secure-api-key
export PORT=3000

# تشغيل السيرفر
node backend/notificationServer.example.js
```

## إعداد Firebase

1. اذهب إلى [Firebase Console](https://console.firebase.google.com)
2. أنشئ مشروع جديد أو استخدم مشروعك الحالي
3. اذهب إلى Project Settings > Service Accounts
4. اضغط على "Generate new private key"
5. احفظ الملف كـ `firebase-service-account.json`
6. أضف هذا الكود في بداية السيرفر:

```javascript
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
```

## اختبار الـ API

```bash
# إرسال إشعار
curl -X POST http://localhost:3000/api/v1/notifications/send \
  -H "Authorization: Bearer your-secure-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "P123456",
    "type": "result_ready",
    "title": {"ar": "نتائجك جاهزة", "en": "Results Ready"},
    "message": {"ar": "اضغط للعرض", "en": "Tap to view"},
    "actionUrl": "Results"
  }'

# جلب الإشعارات
curl http://localhost:3000/api/v1/notifications/P123456 \
  -H "Authorization: Bearer your-secure-api-key"
```

## ملاحظات مهمة

1. **الأمان**: غيّر `API_KEY` لقيمة آمنة
2. **قاعدة البيانات**: استبدل الـ mock database بقاعدة بيانات حقيقية (MongoDB, PostgreSQL, etc.)
3. **HTTPS**: استخدم HTTPS في الإنتاج
4. **Rate Limiting**: أضف حماية من الطلبات الزائدة
