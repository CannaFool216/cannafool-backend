import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import COAResultCard from '../components/COAResultCard';

export default function ResultsScreen({ route, navigation }) {
  const { coaData, sourceUrl } = route.params;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>COA Results</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.scanAgainBtn}>
          <Text style={styles.scanAgainText}>Scan Again</Text>
        </TouchableOpacity>
      </View>

      <COAResultCard data={coaData} />

      {sourceUrl && (
        <Text style={styles.sourceUrl} numberOfLines={1}>
          Source: {sourceUrl}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  scanAgainBtn: {
    backgroundColor: '#7bed9f',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  scanAgainText: {
    color: '#1a1a2e',
    fontWeight: '700',
    fontSize: 13,
  },
  sourceUrl: {
    color: '#555',
    fontSize: 11,
    padding: 16,
    textAlign: 'center',
  },
});
