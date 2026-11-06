import { StyleSheet, Text, View } from 'react-native';

function StatBox({ label, value, unit }: { label: string; value?: number | null; unit?: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>
        {value ?? '—'}
        {value != null && unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function COAResultCard({ data }: { data: any }) {
  if (!data) return null;
  const { thc, cbd, batch_number, terpenes, product_name, lab_name } = data;

  return (
    <View style={styles.container}>
      {product_name && <Text style={styles.productName}>{product_name}</Text>}
      {lab_name && <Text style={styles.labName}>Lab: {lab_name}</Text>}

      <View style={styles.statsRow}>
        <StatBox label="Total THC" value={thc} unit="%" />
        <StatBox label="Total CBD" value={cbd} unit="%" />
        <StatBox label="Batch #" value={batch_number} />
      </View>

      {terpenes?.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Terpenes</Text>
          {terpenes.map((t: any, i: number) => (
            <View key={i} style={styles.terpeneRow}>
              <Text style={styles.terpeneText}>{t.name}</Text>
              {t.percentage && <Text style={styles.terpeneText}>{t.percentage}%</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  productName: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 },
  labName: { fontSize: 13, color: '#aaa', marginBottom: 20 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24, gap: 8 },
  statBox: { flex: 1, backgroundColor: '#2a2a3e', borderRadius: 12, padding: 16, alignItems: 'center' },
  statValue: { fontSize: 26, fontWeight: '800', color: '#7bed9f' },
  statUnit: { fontSize: 14, fontWeight: '400', color: '#7bed9f' },
  statLabel: { fontSize: 11, color: '#aaa', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  section: { backgroundColor: '#2a2a3e', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  terpeneRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#3a3a5e' },
  terpeneText: { color: '#ddd', fontSize: 14 },
});
