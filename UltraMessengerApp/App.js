import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar
} from 'react-native';

const App = () => {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [username, setUsername] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);

  const SERVER_IP = '192.168.100.145';

  const login = () => {
    if (!username.trim()) {
      alert('Введи имя!');
      return;
    }

    try {
      const ws = new WebSocket(`ws://${SERVER_IP}:8080`);
      
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'login', name: username }));
      };
      
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'login_success') setLoggedIn(true);
        if (msg.type === 'message') setMessages(prev => [...prev, msg]);
      };
      
      ws.onerror = () => alert('Ошибка подключения! Проверь сервер');
      setSocket(ws);
    } catch (error) {
      alert('Ошибка: ' + error.message);
    }
  };

  const sendMessage = () => {
    if (inputText.trim() && socket) {
      socket.send(JSON.stringify({ type: 'message', content: inputText }));
      setInputText('');
    }
  };

  if (!loggedIn) {
    return (
      <View style={styles.loginContainer}>
        <Text style={styles.title}>Ultra Messenger</Text>
        <TextInput
          style={styles.input}
          placeholder="Твоё имя"
          placeholderTextColor="#999"
          value={username}
          onChangeText={setUsername}
        />
        <TouchableOpacity style={styles.button} onPress={login}>
          <Text style={styles.buttonText}>Войти</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={messages}
        keyExtractor={(_, index) => index.toString()}
        renderItem={({ item }) => (
          <View style={[styles.message, item.userName === username && styles.myMessage]}>
            <Text style={styles.sender}>{item.userName}:</Text>
            <Text style={styles.text}>{item.content}</Text>
          </View>
        )}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.messageInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Сообщение..."
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Text style={styles.sendButtonText}>➤</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  loginContainer: { flex: 1, justifyContent: 'center', padding: 20 },
  title: { fontSize: 32, textAlign: 'center', marginBottom: 30, color: 'white' },
  input: { borderWidth: 1, padding: 15, marginBottom: 20, borderRadius: 10, backgroundColor: 'white' },
  button: { backgroundColor: '#667eea', padding: 15, borderRadius: 10 },
  buttonText: { color: 'white', textAlign: 'center', fontSize: 18 },
  message: { padding: 10, backgroundColor: 'white', marginVertical: 2, maxWidth: '80%' },
  myMessage: { backgroundColor: '#667eea', alignSelf: 'flex-end' },
  sender: { fontWeight: 'bold' },
  text: { marginTop: 5 },
  inputContainer: { flexDirection: 'row', padding: 10, backgroundColor: 'white' },
  messageInput: { flex: 1, borderWidth: 1, padding: 10, borderRadius: 10, marginRight: 10 },
  sendButton: { backgroundColor: '#667eea', padding: 10, borderRadius: 10 },
  sendButtonText: { color: 'white', fontSize: 20 }
});

export default App;