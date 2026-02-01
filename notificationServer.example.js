/**
 * ==========================================
 * MegaLab Backend API Example
 * ==========================================
 * 
 * مثال لـ Backend API يمكن لمزود الخدمة استخدامه
 * للتكامل مع تطبيق MegaLab
 * 
 * هذا الملف للتوضيح فقط - يتم تنفيذه على السيرفر
 * 
 * Technology: Node.js + Express
 * ==========================================
 */

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin'); // للـ Push Notifications

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// قاعدة البيانات (Mock - استبدله بقاعدة بيانات حقيقية)
// ==========================================
const db = {
  notifications: [],
  devices: [],
  preferences: {},
};

// ==========================================
// Middleware للمصادقة
// ==========================================
const authenticateAPI = (req, res, next) => {
  const apiKey = req.headers.authorization?.replace('Bearer ', '');
  
  // تحقق من API Key
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid API Key' }
    });
  }
  
  next();
};

// ==========================================
// Health Check
// ==========================================
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==========================================
// إرسال إشعار لمريض واحد
// POST /api/v1/notifications/send
// ==========================================
app.post('/api/v1/notifications/send', authenticateAPI, async (req, res) => {
  try {
    const {
      patientId,
      type = 'general',
      priority = 'normal',
      title,
      message,
      data = {},
      actionUrl,
      imageUrl,
      expiresAt,
      scheduledFor
    } = req.body;
    
    // التحقق من البيانات
    if (!patientId || !title || !message) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATA', message: 'Missing required fields' }
      });
    }
    
    const notification = {
      id: `N${Date.now()}`,
      patientId,
      type,
      priority,
      title,
      message,
      data,
      actionUrl,
      imageUrl,
      expiresAt,
      scheduledFor,
      read: false,
      createdAt: new Date().toISOString(),
    };
    
    // حفظ في قاعدة البيانات
    db.notifications.push(notification);
    
    // إرسال Push Notification
    if (!scheduledFor) {
      await sendPushNotification(patientId, notification);
    }
    
    res.json({
      success: true,
      notificationId: notification.id,
      deliveredAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to send notification' }
    });
  }
});

// ==========================================
// إرسال إشعار لمجموعة مرضى
// POST /api/v1/notifications/send-bulk
// ==========================================
app.post('/api/v1/notifications/send-bulk', authenticateAPI, async (req, res) => {
  try {
    const { patientIds, ...notificationData } = req.body;
    
    if (!patientIds || !Array.isArray(patientIds)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATA', message: 'patientIds must be an array' }
      });
    }
    
    const results = [];
    
    for (const patientId of patientIds) {
      const notification = {
        id: `N${Date.now()}_${patientId}`,
        patientId,
        ...notificationData,
        read: false,
        createdAt: new Date().toISOString(),
      };
      
      db.notifications.push(notification);
      await sendPushNotification(patientId, notification);
      
      results.push({ patientId, notificationId: notification.id, success: true });
    }
    
    res.json({ success: true, results });
    
  } catch (error) {
    console.error('Error sending bulk notifications:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to send bulk notifications' }
    });
  }
});

// ==========================================
// إرسال إشعار للجميع (Broadcast)
// POST /api/v1/notifications/broadcast
// ==========================================
app.post('/api/v1/notifications/broadcast', authenticateAPI, async (req, res) => {
  try {
    const { targetGroups, excludePatientIds = [], ...notificationData } = req.body;
    
    // جلب جميع المرضى (من قاعدة البيانات الحقيقية)
    const allPatients = db.devices
      .map(d => d.patientId)
      .filter(id => !excludePatientIds.includes(id));
    
    const uniquePatients = [...new Set(allPatients)];
    
    const broadcastId = `B${Date.now()}`;
    let deliveredCount = 0;
    
    for (const patientId of uniquePatients) {
      const notification = {
        id: `${broadcastId}_${patientId}`,
        patientId,
        ...notificationData,
        read: false,
        createdAt: new Date().toISOString(),
      };
      
      db.notifications.push(notification);
      await sendPushNotification(patientId, notification);
      deliveredCount++;
    }
    
    res.json({
      success: true,
      broadcastId,
      totalRecipients: uniquePatients.length,
      deliveredCount
    });
    
  } catch (error) {
    console.error('Error broadcasting notification:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to broadcast notification' }
    });
  }
});

// ==========================================
// جلب إشعارات مريض
// GET /api/v1/notifications/:patientId
// ==========================================
app.get('/api/v1/notifications/:patientId', authenticateAPI, (req, res) => {
  try {
    const { patientId } = req.params;
    const { limit = 50, offset = 0, unread, types, since } = req.query;
    
    let notifications = db.notifications.filter(n => n.patientId === patientId);
    
    // فلترة
    if (unread === 'true') {
      notifications = notifications.filter(n => !n.read);
    }
    
    if (types) {
      const typeList = types.split(',');
      notifications = notifications.filter(n => typeList.includes(n.type));
    }
    
    if (since) {
      const sinceDate = new Date(since);
      notifications = notifications.filter(n => new Date(n.createdAt) > sinceDate);
    }
    
    // ترتيب وتقطيع
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = notifications.length;
    const unreadCount = notifications.filter(n => !n.read).length;
    notifications = notifications.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    res.json({
      success: true,
      total,
      unreadCount,
      notifications
    });
    
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch notifications' }
    });
  }
});

// ==========================================
// تعليم إشعار كمقروء
// PUT /api/v1/notifications/:notificationId/read
// ==========================================
app.put('/api/v1/notifications/:notificationId/read', authenticateAPI, (req, res) => {
  try {
    const { notificationId } = req.params;
    const { patientId } = req.body;
    
    const notification = db.notifications.find(n => n.id === notificationId && n.patientId === patientId);
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Notification not found' }
      });
    }
    
    notification.read = true;
    notification.readAt = new Date().toISOString();
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error marking as read:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to mark as read' }
    });
  }
});

// ==========================================
// تعليم جميع الإشعارات كمقروءة
// PUT /api/v1/notifications/read-all
// ==========================================
app.put('/api/v1/notifications/read-all', authenticateAPI, (req, res) => {
  try {
    const { patientId } = req.body;
    
    const now = new Date().toISOString();
    db.notifications
      .filter(n => n.patientId === patientId && !n.read)
      .forEach(n => {
        n.read = true;
        n.readAt = now;
      });
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error marking all as read:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to mark all as read' }
    });
  }
});

// ==========================================
// حذف إشعار
// DELETE /api/v1/notifications/:notificationId
// ==========================================
app.delete('/api/v1/notifications/:notificationId', authenticateAPI, (req, res) => {
  try {
    const { notificationId } = req.params;
    const { patientId } = req.body;
    
    const index = db.notifications.findIndex(n => n.id === notificationId && n.patientId === patientId);
    
    if (index === -1) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Notification not found' }
      });
    }
    
    db.notifications.splice(index, 1);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete notification' }
    });
  }
});

// ==========================================
// مسح جميع الإشعارات
// DELETE /api/v1/notifications/clear-all
// ==========================================
app.delete('/api/v1/notifications/clear-all', authenticateAPI, (req, res) => {
  try {
    const { patientId } = req.body;
    
    db.notifications = db.notifications.filter(n => n.patientId !== patientId);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to clear notifications' }
    });
  }
});

// ==========================================
// تسجيل Device Token
// POST /api/v1/devices/register
// ==========================================
app.post('/api/v1/devices/register', authenticateAPI, (req, res) => {
  try {
    const { patientId, token, platform, appVersion } = req.body;
    
    if (!patientId || !token) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATA', message: 'Missing patientId or token' }
      });
    }
    
    // إزالة التسجيلات القديمة لنفس الـ token
    db.devices = db.devices.filter(d => d.token !== token);
    
    // إضافة التسجيل الجديد
    db.devices.push({
      patientId,
      token,
      platform: platform || 'unknown',
      appVersion: appVersion || '1.0.0',
      registeredAt: new Date().toISOString()
    });
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to register device' }
    });
  }
});

// ==========================================
// إلغاء تسجيل Device Token
// DELETE /api/v1/devices/unregister
// ==========================================
app.delete('/api/v1/devices/unregister', authenticateAPI, (req, res) => {
  try {
    const { patientId, token } = req.body;
    
    db.devices = db.devices.filter(d => !(d.patientId === patientId && d.token === token));
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error unregistering device:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to unregister device' }
    });
  }
});

// ==========================================
// جلب تفضيلات الإشعارات
// GET /api/v1/notifications/preferences/:patientId
// ==========================================
app.get('/api/v1/notifications/preferences/:patientId', authenticateAPI, (req, res) => {
  try {
    const { patientId } = req.params;
    
    const defaultPrefs = {
      enabled: true,
      resultReady: true,
      appointments: true,
      offers: true,
      promotions: true,
      system: true,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      sound: true,
      vibration: true,
    };
    
    const prefs = db.preferences[patientId] || defaultPrefs;
    
    res.json(prefs);
    
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch preferences' }
    });
  }
});

// ==========================================
// تحديث تفضيلات الإشعارات
// PUT /api/v1/notifications/preferences
// ==========================================
app.put('/api/v1/notifications/preferences', authenticateAPI, (req, res) => {
  try {
    const { patientId, preferences } = req.body;
    
    if (!patientId || !preferences) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATA', message: 'Missing patientId or preferences' }
      });
    }
    
    db.preferences[patientId] = {
      ...(db.preferences[patientId] || {}),
      ...preferences,
      updatedAt: new Date().toISOString()
    };
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update preferences' }
    });
  }
});

// ==========================================
// مزامنة الإشعارات
// POST /api/v1/notifications/sync
// ==========================================
app.post('/api/v1/notifications/sync', authenticateAPI, (req, res) => {
  try {
    const { patientId, lastSyncTime } = req.body;
    
    let notifications = db.notifications.filter(n => n.patientId === patientId);
    
    if (lastSyncTime) {
      const syncDate = new Date(lastSyncTime);
      notifications = notifications.filter(n => new Date(n.createdAt) > syncDate);
    }
    
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json({
      success: true,
      notifications,
      deletedIds: [], // قائمة الإشعارات المحذوفة منذ آخر مزامنة
      syncTime: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error syncing notifications:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to sync notifications' }
    });
  }
});

// ==========================================
// Helper: إرسال Push Notification
// ==========================================
async function sendPushNotification(patientId, notification) {
  try {
    const devices = db.devices.filter(d => d.patientId === patientId);
    
    if (devices.length === 0) {
      console.log(`No registered devices for patient ${patientId}`);
      return;
    }
    
    // تحقق من تفضيلات المستخدم
    const prefs = db.preferences[patientId];
    if (prefs && !prefs.enabled) {
      console.log(`Notifications disabled for patient ${patientId}`);
      return;
    }
    
    // تحقق من نوع الإشعار
    if (prefs) {
      const typePrefs = {
        result_ready: prefs.resultReady,
        appointment: prefs.appointments,
        offer: prefs.offers,
        promotion: prefs.promotions,
      };
      
      if (typePrefs[notification.type] === false) {
        console.log(`Notification type ${notification.type} disabled for patient ${patientId}`);
        return;
      }
    }
    
    // إرسال عبر FCM (Firebase Cloud Messaging)
    for (const device of devices) {
      const message = {
        token: device.token,
        notification: {
          title: notification.title.ar || notification.title.en,
          body: notification.message.ar || notification.message.en,
        },
        data: {
          notificationId: notification.id,
          type: notification.type,
          actionUrl: notification.actionUrl || '',
          ...notification.data,
        },
        android: {
          priority: notification.priority === 'urgent' ? 'high' : 'normal',
          notification: {
            sound: prefs?.sound !== false ? 'default' : null,
            channelId: 'megalab_notifications',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: prefs?.sound !== false ? 'default' : null,
              badge: 1,
            },
          },
        },
      };
      
      // await admin.messaging().send(message);
      console.log(`Push notification sent to device ${device.token.substring(0, 10)}...`);
    }
    
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

// ==========================================
// Start Server
// ==========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
  ==========================================
  🚀 MegaLab Notification API Server
  ==========================================
  
  Server running on port ${PORT}
  
  Endpoints:
  - POST   /api/v1/notifications/send
  - POST   /api/v1/notifications/send-bulk
  - POST   /api/v1/notifications/broadcast
  - GET    /api/v1/notifications/:patientId
  - PUT    /api/v1/notifications/:notificationId/read
  - PUT    /api/v1/notifications/read-all
  - DELETE /api/v1/notifications/:notificationId
  - DELETE /api/v1/notifications/clear-all
  - POST   /api/v1/devices/register
  - DELETE /api/v1/devices/unregister
  - GET    /api/v1/notifications/preferences/:patientId
  - PUT    /api/v1/notifications/preferences
  - POST   /api/v1/notifications/sync
  
  ==========================================
  `);
});

module.exports = app;
