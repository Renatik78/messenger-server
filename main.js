const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let tray = null;
let serverProcess = null;

function createWindow() {
    // Запускаем сервер
    serverProcess = spawn('node', [path.join(__dirname, 'server.js')]);
    
    serverProcess.stdout.on('data', (data) => {
        console.log(`Сервер: ${data}`);
    });

    // Создаем окно
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Загружаем приложение
    mainWindow.loadFile('index.html');

    // Создаем меню
    const menu = Menu.buildFromTemplate([
        {
            label: 'Файл',
            submenu: [
                { label: 'Выход', click: () => app.quit() }
            ]
        }
    ]);
    
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (serverProcess) {
        serverProcess.kill();
    }
});