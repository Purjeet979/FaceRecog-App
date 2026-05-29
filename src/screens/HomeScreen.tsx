import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function HomeScreen({ navigation }: any) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Datalake 3.0</Text>
      <Text style={styles.subtitle}>Biometric Offline Prototype</Text>

      <View style={styles.card}>
        <Text style={styles.cardText}>
          Welcome to the native React Native port of the NHAI Biometric system. 
          This app runs liveness checks 100% offline using Edge AI.
        </Text>
      </View>

      <TouchableOpacity 
        style={styles.primaryButton}
        onPress={() => navigation?.navigate?.('Enroll')}
      >
        <Text style={styles.buttonText}>Get Started (Enroll)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#38bdf8',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 18,
    color: '#94a3b8',
    marginBottom: 40,
  },
  card: {
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 40,
  },
  cardText: {
    color: '#cbd5e1',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  primaryButton: {
    backgroundColor: '#38bdf8',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 8,
    elevation: 3,
  },
  buttonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
