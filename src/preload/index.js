import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 安全暴露数据读写能力，渲染进程无法直接接触 Node.js
const api = {
  readData: () => ipcRenderer.invoke('data:read'),
  writeData: (data) => ipcRenderer.invoke('data:write', data),
  fetchNews: () => ipcRenderer.invoke('news:fetch'),
  openExternal: (url) => ipcRenderer.invoke('news:open', url),
  getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
  saveApiKey: (key) => ipcRenderer.invoke('settings:saveApiKey', key),
  openFeedbackMail: (payload) => ipcRenderer.invoke('feedback:openMail', payload),
  listMailClients: () => ipcRenderer.invoke('feedback:listMailClients')
}

contextBridge.exposeInMainWorld('api', api)
