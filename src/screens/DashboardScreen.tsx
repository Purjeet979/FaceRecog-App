import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { StorageEngine, AuthRecord, FaceTemplate } from '../StorageEngine';
import { SyncEngine } from '../SyncEngine';

export default function DashboardScreen() {
  const [records, setRecords] = useState<AuthRecord[]>([]);
  const [templates, setTemplates] = useState<FaceTemplate[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'logs' | 'users'>('logs');

  // Refresh records and templates when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      setRecords(StorageEngine.getAllRecords());
      setTemplates(StorageEngine.getAllTemplates());
    }, [])
  );

  const handleManualSync = async () => {
    setIsSyncing(true);
    await SyncEngine.syncPendingRecords();
    setIsSyncing(false);
    setRecords(StorageEngine.getAllRecords()); // Refresh after purge
    Alert.alert('Sync Complete', 'Pending records were synced and purged from device.');
  };

  const handleDeleteTemplate = (userId: string) => {
    Alert.alert(
      'Confirm Delete',
      `Are you sure you want to delete the enrolled face for employee "${userId}"?\n\nThis will remove their biometric data from the device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: () => {
            StorageEngine.deleteTemplate(userId);
            setTemplates(StorageEngine.getAllTemplates());
            Alert.alert('Success', `Enrolled face for employee "${userId}" has been deleted.`);
          }
        }
      ]
    );
  };

  const renderRecord = ({ item }: { item: AuthRecord }) => (
    <View style={styles.recordCard}>
      <View style={styles.recordRow}>
        <Text style={styles.recordId}>{item.userId}</Text>
        <Text style={item.synced ? styles.badgeSynced : styles.badgePending}>
          {item.synced ? 'SYNCED' : 'PENDING'}
        </Text>
      </View>
      <Text style={styles.recordDate}>{new Date(item.timestamp).toLocaleString()}</Text>
      <Text style={styles.recordLiveness}>
        Liveness Check: {item.livenessPassed ? '✅ PASSED' : '❌ FAILED'}
      </Text>
    </View>
  );

  const renderTemplateItem = ({ item }: { item: FaceTemplate }) => (
    <View style={styles.recordCard}>
      <View style={styles.recordRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.recordId}>{item.user_id}</Text>
          <Text style={styles.recordDate}>
            Enrolled: {new Date(item.enrollment_date).toLocaleDateString()} at {new Date(item.enrollment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={styles.recordLiveness}>
            Quality at Enrolment: {item.quality_score ? `${Math.round(item.quality_score * 100)}%` : 'N/A'}
          </Text>
        </View>
        <TouchableOpacity 
          style={styles.deleteBtn} 
          onPress={() => handleDeleteTemplate(item.user_id)}
        >
          <Text style={styles.deleteBtnTxt}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const pendingCount = records.filter(r => !r.synced).length;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Admin Dashboard</Text>
      
      <View style={styles.statsCard}>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>{records.length}</Text>
          <Text style={styles.statLabel}>Total Logs</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: '#f59e0b' }]}>{pendingCount}</Text>
          <Text style={styles.statLabel}>Pending Sync</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: '#38bdf8' }]}>{templates.length}</Text>
          <Text style={styles.statLabel}>Enrolled Faces</Text>
        </View>
      </View>

      <TouchableOpacity 
        style={[styles.syncBtn, pendingCount === 0 && { opacity: 0.5 }]} 
        onPress={handleManualSync}
        disabled={pendingCount === 0 || isSyncing}
      >
        <Text style={styles.syncBtnTxt}>
          {isSyncing ? 'Syncing...' : '🔄 Force Manual Sync'}
        </Text>
      </TouchableOpacity>

      {/* Tab Selection */}
      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'logs' && styles.tabButtonActive]} 
          onPress={() => setActiveTab('logs')}
        >
          <Text style={[styles.tabText, activeTab === 'logs' && styles.tabTextActive]}>
            Audit Logs
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'users' && styles.tabButtonActive]} 
          onPress={() => setActiveTab('users')}
        >
          <Text style={[styles.tabText, activeTab === 'users' && styles.tabTextActive]}>
            Enrolled Users
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={activeTab === 'logs' ? records.slice().reverse() : templates}
        keyExtractor={item => activeTab === 'logs' ? (item as AuthRecord).id : (item as FaceTemplate).user_id}
        renderItem={activeTab === 'logs' ? renderRecord as any : renderTemplateItem as any}
        ListEmptyComponent={
          <Text style={styles.emptyTxt}>
            {activeTab === 'logs' ? 'No logs found.' : 'No enrolled users found.'}
          </Text>
        }
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  header: { fontSize: 24, fontWeight: 'bold', color: 'white', marginBottom: 20 },
  statsCard: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  statBox: { flex: 1, backgroundColor: '#1e293b', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#334155', marginHorizontal: 4, alignItems: 'center' },
  statNum: { fontSize: 24, fontWeight: 'bold', color: '#10b981' },
  statLabel: { color: '#94a3b8', fontSize: 11, marginTop: 5, textAlign: 'center' },
  syncBtn: { backgroundColor: '#38bdf8', padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 20 },
  syncBtnTxt: { color: '#0f172a', fontWeight: 'bold', fontSize: 16 },
  
  tabContainer: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 8, padding: 4, marginBottom: 15, borderHeight: 1, borderColor: '#334155' },
  tabButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabButtonActive: { backgroundColor: '#38bdf8' },
  tabText: { color: '#94a3b8', fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: '#0f172a', fontWeight: 'bold' },

  recordCard: { backgroundColor: '#1e293b', padding: 15, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  recordRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recordId: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  badgePending: { backgroundColor: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, fontSize: 12, fontWeight: 'bold' },
  badgeSynced: { backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#10b981', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, fontSize: 12, fontWeight: 'bold' },
  recordDate: { color: '#94a3b8', fontSize: 12, marginTop: 4, marginBottom: 4 },
  recordLiveness: { color: '#cbd5e1', fontSize: 13 },
  emptyTxt: { color: '#64748b', textAlign: 'center', marginTop: 20 },
  
  deleteBtn: { backgroundColor: 'rgba(239, 68, 68, 0.15)', width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.4)' },
  deleteBtnTxt: { fontSize: 16 }
});
