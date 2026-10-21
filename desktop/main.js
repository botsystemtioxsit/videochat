// Десктоп-обёртка над живой страницей видеочата — как у игры и админ-панели:
// окно Electron открывает ту же страницу, что и браузер, поэтому обновление
// страницы (push в main → GitHub Pages) долетает сюда без переустановки.
// Обновляется через electron-updater только сама обёртка (версия Electron,
// иконка, разрешения), а ставит и обновляет её TIOXSIT Launcher.
const { app, BrowserWindow, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const VIDEOCHAT_URL = 'https://botsystemtioxsit.github.io/videochat/';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 420,
    minHeight: 600,
    title: 'ВидеоЧат',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0B0B0D', // как фон страницы — без белой вспышки при загрузке
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false, // страница — веб-контент, Node.js ей не нужен
    },
  });

  win.loadURL(VIDEOCHAT_URL);

  // Внешние ссылки открываем в обычном браузере, а не вторым окном без адресной строки
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Видеочату нужны камера и микрофон (getUserMedia). По умолчанию Electron такие
// запросы молча отклоняет — разрешаем только «media», остальное по-прежнему закрыто.
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => permission === 'media');

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Только в собранном приложении; в dev-режиме (npm start) ничего не делает.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('Автообновление: проверка не удалась', err);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
