import React from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import HomeScreen from './src/screens/HomeScreen';
import EnrollScreen from './src/screens/EnrollScreen';
import AuthScreen from './src/screens/AuthScreen';
import LiveScanScreen from './src/screens/LiveScanScreen';
import DashboardScreen from './src/screens/DashboardScreen';

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { console.error('ErrorBoundary caught:', error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: 'red', padding: 20, justifyContent: 'center' }}>
          <Text style={{ color: 'white', fontWeight: 'bold' }}>FATAL ERROR:</Text>
          <Text style={{ color: 'white' }}>{String(this.state.error)}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <ErrorBoundary>
      <NavigationContainer>
        <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#fff',
          tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#334155' },
          tabBarActiveTintColor: '#38bdf8',
          tabBarInactiveTintColor: '#94a3b8',
        }}
      >
        <Tab.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{ tabBarIcon: () => <Text style={{fontSize: 20}}>🏠</Text> }} 
        />
        <Tab.Screen 
          name="Enroll" 
          component={EnrollScreen} 
          options={{ tabBarIcon: () => <Text style={{fontSize: 20}}>📝</Text> }} 
        />
        <Tab.Screen 
          name="Auth" 
          component={AuthScreen} 
          options={{ tabBarIcon: () => <Text style={{fontSize: 20}}>🔐</Text> }} 
        />
        <Tab.Screen 
          name="Scan" 
          component={LiveScanScreen} 
          options={{ tabBarIcon: () => <Text style={{fontSize: 20}}>📷</Text> }} 
        />
        <Tab.Screen 
          name="Dashboard" 
          component={DashboardScreen} 
          options={{ tabBarIcon: () => <Text style={{fontSize: 20}}>📊</Text> }} 
        />
      </Tab.Navigator>
    </NavigationContainer>
    </ErrorBoundary>
  );
}
