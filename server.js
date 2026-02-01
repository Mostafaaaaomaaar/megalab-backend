/**
 * ==========================================
 * MegaLab Backend Server
 * ==========================================
 * يفحص الإشعارات من الموقع الأونلاين باستخدام Puppeteer
 * ويرسلها للتطبيق عبر API
 * 
 * npm install express puppeteer cors dotenv
 * node server.js
 */

const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// تخزين آخر الإشعارات المفحوصة
const lastNotifications = {};

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/**
 * Main Endpoint: Check Notifications
 * POST /api/check-notifications
 * 
 * Request Body:
 * {
 *   users: [
 *     { id, name, username, password }
 *   ]
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   newNotifications: [
 *     { userName, notifications: [...] }
 *   ]
 * }
 */
app.post('/api/check-notifications', async (req, res) => {
  try {
    const { users } = req.body;

    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid users array'
      });
    }

    console.log(`\n📋 ========== فحص الإشعارات ==========`);
    console.log(`📅 ${new Date().toLocaleTimeString('ar-EG')}`);
    console.log(`👥 عدد المستخدمين: ${users.length}`);

    const allResults = [];

    // فحص كل مستخدم
    for (const user of users) {
      try {
        console.log(`\n👤 يتم فحص: ${user.name}`);

        const result = await checkUserNotifications(user);

        allResults.push({
          userId: user.id,
          userName: user.name,
          success: true,
          notifications: result.notifications,
          isNew: result.isNew
        });

      } catch (error) {
        console.error(`❌ [${user.name}] خطأ:`, error.message);

        allResults.push({
          userId: user.id,
          userName: user.name,
          success: false,
          error: error.message,
          notifications: []
        });
      }
    }

    // تصفية النتائج الناجحة والإشعارات الجديدة
    const newNotifications = allResults.filter(r => r.success && r.isNew);

    console.log(`\n✅ انتهى الفحص - إشعارات جديدة: ${newNotifications.length}`);
    console.log(`📋 ==========================================\n`);

    res.json({
      success: true,
      totalUsers: users.length,
      successCount: allResults.filter(r => r.success).length,
      newNotificationsCount: newNotifications.length,
      results: allResults,
      newNotifications: newNotifications
    });

  } catch (error) {
    console.error('❌ Server Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * فحص إشعارات مستخدم واحد
 */
async function checkUserNotifications(user) {
  let browser;

  try {
    console.log(`  🌐 فتح المتصفح...`);

    // تشغيل Puppeteer - إعدادات للسحابة
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--single-process',
        '--no-zygote'
      ],
      // للسحابة: استخدم Chrome المثبت مسبقاً إن وجد
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    });

    const page = await browser.newPage();

    // تحديد User Agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    );

    // 1️⃣ الذهاب إلى صفحة تسجيل الدخول
    console.log(`  🔐 الدخول إلى الموقع...`);
    await page.goto(
      'https://megaegyptlabresult.gts-sys.com/Patient/Login',
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );

    // 2️⃣ ملء بيانات الدخول
    console.log(`  ✏️  ملء بيانات الدخول...`);
    await page.type('input[name="Id"]', user.username, { delay: 50 });
    await page.type('input[name="password"]', user.password, { delay: 50 });

    // 3️⃣ الضغط على زر تسجيل الدخول
    console.log(`  🔘 الضغط على تسجيل الدخول...`);
    await page.click('button[type="submit"]');

    // انتظر تحميل الصفحة التالية (بـ timeout أطول)
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      console.log(`  ⚠️  تحذير: ${e.message}, سنحاول المتابعة...`);
    }

    console.log(`  ✅ تم التسجيل بنجاح`);

    // 4️⃣ الذهاب لصفحة الإشعارات
    console.log(`  📢 جلب الإشعارات...`);
    await page.goto(
      'https://megaegyptlabresult.gts-sys.com/Patient/Notification',
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );

    // انتظر تحميل JavaScript
    await page.waitForTimeout(3000);

    // 5️⃣ استخراج الإشعارات وآخر Visit ID من الـ DOM
    console.log(`  🔍 استخراج البيانات...`);

    const pageData = await page.evaluate(() => {
      const notifs = [];
      let latestVisitId = null;
      let latestVisitUrl = null;

      // 1. استخراج آخر Visit ID من الروابط
      const visitLinks = document.querySelectorAll('a[href*="VisitId="]');
      if (visitLinks.length > 0) {
        // أول رابط هو الأحدث
        const firstLink = visitLinks[0];
        const href = firstLink.href;
        const match = href.match(/VisitId=(\d+)/);
        if (match) {
          latestVisitId = match[1];
          latestVisitUrl = href;
        }
      }

      // 2. البحث عن الإشعارات في Dropdown
      const dropdown = document.querySelector('.dropdown-notification');
      if (dropdown) {
        const notificationItems = dropdown.querySelectorAll('a, li, div');
        notificationItems.forEach((item, idx) => {
          const text = item.textContent?.trim();
          const href = item.href || '';
          
          if (text && text.length > 5 && !text.includes('Read all')) {
            // استخراج Visit ID من الرابط إن وجد
            let visitId = null;
            const visitMatch = href.match(/VisitId=(\d+)/);
            if (visitMatch) {
              visitId = visitMatch[1];
            }
            
            notifs.push({
              id: `notification_${idx}`,
              text: text.substring(0, 200),
              type: 'dropdown',
              visitId: visitId,
              visitUrl: visitId ? `https://megaegyptlabresult.gts-sys.com/Patient/Visit?VisitId=${visitId}` : null,
              timestamp: Date.now()
            });
          }
        });
      }

      // 3. البحث عن الإشعارات في الرسائل المرئية
      const bodyText = document.body.innerText || '';
      
      const keywords = [
        'Your Result is Ready',
        'النتيجة جاهزة',
        'Result Ready',
        'نتيجة',
        'Ready in'
      ];

      keywords.forEach(keyword => {
        if (bodyText.includes(keyword)) {
          const lines = bodyText.split('\n');
          lines.forEach((line, idx) => {
            if (line.includes(keyword) && line.length > 5) {
              notifs.push({
                id: `keyword_${keyword}_${idx}`,
                text: line.trim().substring(0, 200),
                type: 'keyword',
                timestamp: Date.now()
              });
            }
          });
        }
      });

      // 4. البحث عن النتائج الجديدة في جدول الأنشطة
      const table = document.querySelector('table');
      if (table) {
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach((row, idx) => {
          const cells = row.querySelectorAll('td');
          if (cells.length > 0) {
            const rowData = Array.from(cells).map(c => c.textContent.trim()).join(' | ');
            if (rowData && rowData.length > 5) {
              notifs.push({
                id: `result_${idx}`,
                text: rowData.substring(0, 200),
                type: 'result',
                timestamp: Date.now()
              });
            }
          }
        });
      }

      return {
        notifications: notifs,
        latestVisitId,
        latestVisitUrl
      };
    });

    const notifications = pageData.notifications;
    const latestVisitId = pageData.latestVisitId;
    const latestVisitUrl = pageData.latestVisitUrl || `https://megaegyptlabresult.gts-sys.com/Patient/Visit?VisitId=${latestVisitId}`;

    console.log(`  📊 وجدنا ${notifications.length} عنصر(ات)`);
    console.log(`  🆔 آخر Visit ID: ${latestVisitId}`);

    // 6️⃣ تصفية الإشعارات الجديدة (غير المقروءة)
    const previousNotifications = lastNotifications[user.id] || [];
    const newNotifications = notifications.filter(current => {
      return !previousNotifications.some(prev =>
        prev.text === current.text || 
        (prev.text && current.text && prev.text.substring(0, 50) === current.text.substring(0, 50))
      );
    });

    console.log(`  🆕 إشعارات جديدة: ${newNotifications.length}`);

    // 7️⃣ قراءة الإشعارات على الموقع (Mark as Read)
    if (newNotifications.length > 0 || notifications.length > 0) {
      console.log(`  📖 تمييز الإشعارات كمقروءة على الموقع...`);
      
      try {
        // الطريقة 1: الذهاب لرابط "Read all notifications"
        console.log(`    → جاري الضغط على "Read all notifications"...`);
        await page.goto(
          'https://megaegyptlabresult.gts-sys.com/Notification?Area=Configuration',
          { waitUntil: 'domcontentloaded', timeout: 30000 }
        );
        await page.waitForTimeout(2000);
        console.log(`    ✓ تم زيارة صفحة قراءة جميع الإشعارات`);

        // الطريقة 2: الضغط على كل رابط إشعار لتمييزه كمقروء (Seen)
        // الموقع يُسجل "Seen Time" عند زيارة رابط الإشعار
        const visitIds = notifications
          .filter(n => n.visitId)
          .map(n => n.visitId)
          .slice(0, 5); // أول 5 إشعارات فقط لتوفير الوقت

        if (visitIds.length > 0) {
          console.log(`    → تمييز ${visitIds.length} إشعار(ات) كمقروءة...`);
          
          for (const visitId of visitIds) {
            try {
              await page.goto(
                `https://megaegyptlabresult.gts-sys.com/Patient/Visit?VisitId=${visitId}`,
                { waitUntil: 'domcontentloaded', timeout: 15000 }
              );
              await page.waitForTimeout(1000);
              console.log(`    ✓ تم تمييز Visit ${visitId} كمقروء`);
            } catch (e) {
              console.log(`    ⚠ فشل تمييز Visit ${visitId}`);
            }
          }
        }
        
        console.log(`  ✅ تم تمييز جميع الإشعارات كمقروءة`);
      } catch (markError) {
        console.log(`  ⚠️ لم نتمكن من تمييز الإشعارات: ${markError.message}`);
      }
    }

    // تحديث آخر الإشعارات
    lastNotifications[user.id] = notifications;

    // 8️⃣ إغلاق المتصفح
    await browser.close();

    // 9️⃣ تجهيز الإشعارات بالرابط للتطبيق (رابط آخر زيارة)
    const latestResultUrl = latestVisitUrl || `https://megaegyptlabresult.gts-sys.com/Patient/Visit?VisitId=${latestVisitId}`;
    
    const formattedNotifications = newNotifications.length > 0 
      ? newNotifications.map(n => ({
          ...n,
          // إضافة رابط آخر زيارة/نتيجة
          resultUrl: n.visitUrl || latestResultUrl,
          visitId: n.visitId || latestVisitId,
          // تنسيق الرسالة للتطبيق
          appMessage: {
            ar: `${user.name} تم الانتهاء من تحاليلكم والنتيجة`,
            en: `${user.name} Your test results are ready`,
            linkText: { ar: 'هنا', en: 'here' }
          }
        }))
      : [];

    console.log(`  🔗 رابط آخر نتيجة: ${latestResultUrl}`);

    return {
      notifications: formattedNotifications.length > 0 ? formattedNotifications : notifications,
      isNew: newNotifications.length > 0,
      totalCount: notifications.length,
      // رابط آخر زيارة/نتيجة
      latestVisitId: latestVisitId,
      latestResultUrl: latestResultUrl,
      resultsUrl: latestResultUrl
    };

  } catch (error) {
    console.error(`  ❌ خطأ:`, error.message);
    
    if (browser) {
      await browser.close().catch(() => {});
    }

    throw error;
  }
}

/**
 * معلومات عن API
 */
app.get('/api/info', (req, res) => {
  res.json({
    name: 'MegaLab Notification Server',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      checkNotifications: 'POST /api/check-notifications',
      info: 'GET /api/info'
    },
    example: {
      method: 'POST',
      url: '/api/check-notifications',
      body: {
        users: [
          {
            id: 'user1',
            name: 'أحمد',
            username: '2299',
            password: '67092538'
          }
        ]
      }
    }
  });
});

/**
 * Error handling
 */
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// ==================================================
// 📱 EXPO PUSH NOTIFICATIONS
// ==================================================

/**
 * إرسال Push Notification عبر Expo
 * @param {string} pushToken - Expo Push Token
 * @param {string} title - عنوان الإشعار
 * @param {string} body - نص الإشعار
 * @param {object} data - بيانات إضافية
 */
async function sendPushNotification(pushToken, title, body, data = {}) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) {
    console.log('⚠️ Push Token غير صالح:', pushToken);
    return { success: false, error: 'Invalid push token' };
  }

  const message = {
    to: pushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
    priority: 'high',
    channelId: 'results' // قناة النتائج
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    console.log('📤 Push Notification Result:', result);
    return { success: true, result };
  } catch (error) {
    console.error('❌ Push Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Endpoint: إرسال Push Notification
 * POST /api/send-push
 */
app.post('/api/send-push', async (req, res) => {
  const { pushToken, title, body, data } = req.body;

  if (!pushToken || !title || !body) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: pushToken, title, body'
    });
  }

  const result = await sendPushNotification(pushToken, title, body, data);
  res.json(result);
});

/**
 * Endpoint: فحص الإشعارات وإرسال Push
 * POST /api/check-and-notify
 * 
 * Request Body:
 * {
 *   users: [{ id, name, username, password, pushToken }]
 * }
 */
app.post('/api/check-and-notify', async (req, res) => {
  try {
    const { users } = req.body;

    if (!users || !Array.isArray(users)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid users array'
      });
    }

    console.log(`\n📋 ========== فحص وإشعار ==========`);

    const results = [];

    for (const user of users) {
      try {
        // فحص الإشعارات
        const checkResult = await checkUserNotifications(user);

        if (checkResult.isNew && checkResult.notifications.length > 0) {
          // إرسال Push Notification
          if (user.pushToken) {
            const pushResult = await sendPushNotification(
              user.pushToken,
              '🔬 نتائجك جاهزة!',
              `${user.name} تم الانتهاء من تحاليلكم والنتيجة جاهزة`,
              {
                type: 'results_ready',
                url: checkResult.resultsUrl,
                userId: user.id
              }
            );

            results.push({
              userId: user.id,
              userName: user.name,
              notificationsFound: checkResult.notifications.length,
              pushSent: pushResult.success,
              resultsUrl: checkResult.resultsUrl
            });
          } else {
            results.push({
              userId: user.id,
              userName: user.name,
              notificationsFound: checkResult.notifications.length,
              pushSent: false,
              reason: 'No push token'
            });
          }
        } else {
          results.push({
            userId: user.id,
            userName: user.name,
            notificationsFound: 0,
            isNew: false
          });
        }
      } catch (error) {
        results.push({
          userId: user.id,
          userName: user.name,
          error: error.message
        });
      }
    }

    console.log(`✅ انتهى - تم إرسال ${results.filter(r => r.pushSent).length} إشعار(ات)`);

    res.json({
      success: true,
      results
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Start Server
 */
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🚀 MegaLab Server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`📍 GET http://localhost:${PORT}/health`);
  console.log(`📍 POST http://localhost:${PORT}/api/check-notifications`);
  console.log(`${'='.repeat(50)}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⛔ Shutting down server...');
  process.exit(0);
});
