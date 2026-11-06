import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { parseCOA } from '../services/api';

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const scannedRef = useRef(false);

  async function handleBarcodeScan({ data: url }: { data: string }) {
    if (scannedRef.current || loading) return;
    scannedRef.current = true;

    if (!url.startsWith('http')) {
      Alert.alert('Invalid QR Code', 'This QR code does not link to a document.', [
        { text: 'Scan Again', onPress: () => (scannedRef.current = false) },
      ]);
      return;
    }

    setLoading(true);
    try {
      const coaData = await parseCOA(url);
      router.push({ pathname: '/results', params: { coaData: JSON.stringify(coaData), sourceUrl: url } });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not read COA.', [
        { text: 'Try Again', onPress: () => (scannedRef.current = false) },
      ]);
    } finally {
      setLoading(false);
      scannedRef.current = false;
    }
  }

  if (!permission) return <View style={styles.center} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Camera access is required to scan QR codes.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={handleBarcodeScan}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />
      <View style={styles.overlay}>
        <View style={styles.viewfinder} />
        <Text style={styles.hint}>Point at a COA QR code</Text>
      </View>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#7bed9f" />
          <Text style={styles.loadingText}>Reading COA…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e', padding: 24 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewfinder: { width: 240, height: 240, borderWidth: 2, borderColor: '#7bed9f', borderRadius: 16 },
  hint: { marginTop: 20, color: '#fff', fontSize: 14, opacity: 0.8 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#fff', fontSize: 16 },
  permissionText: { color: '#fff', textAlign: 'center', marginBottom: 20, fontSize: 15 },
  button: { backgroundColor: '#7bed9f', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: '#1a1a2e', fontWeight: '700', fontSize: 15 },
});
