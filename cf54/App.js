import React, { useRef, useState, useEffect, useMemo } from 'react';
import * as Updates from 'expo-updates';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { useFonts, FredokaOne_400Regular } from '@expo-google-fonts/fredoka-one';
import { Cinzel_400Regular, Cinzel_700Bold } from '@expo-google-fonts/cinzel';
import { Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const BASE_URL = 'https://cannafool-backend.onrender.com';
const SUPABASE_URL = 'https://uijmqieglkryrkhszimg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpam1xaWVnbGtyeXJraHN6aW1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMjQ0MDMsImV4cCI6MjEwNzYwMDQwM30.eyeZzr-2f_ZpIf9Zos_-9Vylei0jhEdpO5d1kRdTg6k';

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 80 : 64;

// ── Auth Helpers ───────────────────────────────────────────────────────────────

async function supabaseSignUp(internalEmail, password, username, realEmail) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body: JSON.stringify({ email: internalEmail, password, data: { username, real_email: realEmail } }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.msg || json.error_description || 'Signup failed');
  return json;
}

async function supabaseSignIn(email, password) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body: JSON.stringify({ email, password }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error_description || json.msg || 'Login failed');
  return json;
}

async function storeUser(userId, username, accessToken) {
  await AsyncStorage.setItem('cf_user', JSON.stringify({ userId, username, accessToken }));
}

async function getStoredUser() {
  const raw = await AsyncStorage.getItem('cf_user');
  return raw ? JSON.parse(raw) : null;
}

async function clearUser() {
  await AsyncStorage.removeItem('cf_user');
}

// ── API Helpers ────────────────────────────────────────────────────────────────

async function parseCOA(url, userId) {
  const response = await fetch(`${BASE_URL}/parse-coa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, user_id: userId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to parse COA');
  }
  return response.json();
}

async function submitReview(reviewData, userId) {
  const response = await fetch(`${BASE_URL}/submit-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...reviewData, device_id: userId }),
  });
  if (!response.ok) throw new Error('Failed to submit review');
  return response.json();
}

async function fetchReviews(strain, cultivator) {
  const params = new URLSearchParams({ strain: strain || '', cultivator: cultivator || '' });
  const response = await fetch(`${BASE_URL}/get-reviews?${params}`);
  if (!response.ok) return [];
  return response.json();
}

async function fetchComments(reviewId) {
  const response = await fetch(`${BASE_URL}/get-comments?review_id=${reviewId}`);
  if (!response.ok) return [];
  return response.json();
}

async function postComment(reviewId, userId, username, comment) {
  const response = await fetch(`${BASE_URL}/add-comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ review_id: reviewId, device_id: userId, username, comment }),
  });
  if (!response.ok) throw new Error('Failed to post comment');
  return response.json();
}

async function uploadPhoto(base64) {
  const filename = `bag_appeal_${Date.now()}.jpg`;
  const byteArray = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/review-media/${filename}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/jpeg' },
      body: byteArray,
    }
  );
  if (!response.ok) throw new Error(`Upload failed: ${await response.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/review-media/${filename}`;
}

async function fetchScanHistory(userId) {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/SCANS?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=100&select=*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return [];
    const rows = await resp.json();
    return rows.map(r => ({ ...r, strain: cleanStrainName(r.strain) }));
  } catch { return []; }
}

async function fetchCommunityFeed(category = 'All') {
  try {
    let url = `${SUPABASE_URL}/rest/v1/REVIEWS?select=id,strain,cultivator,batch_number,overall,comment,username,bag_appeal_photo,created_at,product_type&order=created_at.desc&limit=100`;
    if (category === 'Pre-Roll') url += `&or=(product_type.eq.Pre-Roll,product_type.eq.Infused Pre-Roll)`;
    else if (category !== 'All') url += `&product_type=eq.${encodeURIComponent(category)}`;
    const resp = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    if (!resp.ok) return [];
    const reviews = await resp.json();
    // Group by batch_number (fall back to strain+cultivator for old reviews without batch)
    const groups = {};
    reviews.forEach(r => {
      const key = r.batch_number || `${r.strain}||${r.cultivator || ''}`;
      if (!groups[key]) groups[key] = { batch_number: r.batch_number, strain: r.strain, cultivator: r.cultivator, reviews: [] };
      groups[key].reviews.push(r);
    });
    return Object.values(groups).sort((a, b) => new Date(b.reviews[0].created_at) - new Date(a.reviews[0].created_at));
  } catch { return []; }
}

async function fetchScanByStrain(strain) {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/SCANS?strain=eq.${encodeURIComponent(strain)}&order=created_at.desc&limit=1&select=*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    return rows[0] ? scanRowToCoaData(rows[0]) : null;
  } catch { return null; }
}

async function fetchTrendingStrains(category = 'All') {
  try {
    let url = `${SUPABASE_URL}/rest/v1/REVIEWS?select=strain,cultivator,overall,product_type&order=created_at.desc&limit=500`;
    if (category !== 'All') url += `&product_type=eq.${encodeURIComponent(category)}`;
    const resp = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    if (!resp.ok) return { top: [], bottom: [] };
    const reviews = await resp.json();

    const strainMap = {};
    reviews.forEach(r => {
      if (!r.strain || r.overall == null) return;
      // For Pre-Roll tab, include both Pre-Roll and Infused Pre-Roll
      if (category === 'Pre-Roll' && r.product_type !== 'Pre-Roll' && r.product_type !== 'Infused Pre-Roll') return;
      const key = `${r.strain}||${r.cultivator || ''}`;
      if (!strainMap[key]) strainMap[key] = { strain: r.strain, cultivator: r.cultivator, ratings: [] };
      strainMap[key].ratings.push(r.overall);
    });

    const aggregated = Object.values(strainMap)
      .filter(s => s.ratings.length >= 2)
      .map(s => ({
        strain: s.strain,
        cultivator: s.cultivator,
        avg: parseFloat((s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length).toFixed(1)),
        count: s.ratings.length,
      }))
      .sort((a, b) => b.avg - a.avg);

    const top = aggregated.filter(s => s.avg >= 4.0).slice(0, 5);
    const topStrains = new Set(top.map(s => s.strain));
    const bottom = aggregated
      .filter(s => s.avg <= 2.5 && !topStrains.has(s.strain))
      .slice(-3).reverse();
    return { top, bottom };
  } catch { return { top: [], bottom: [] }; }
}

async function fetchUserTopRated(userId) {
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/REVIEWS?device_id=eq.${encodeURIComponent(userId)}&order=overall.desc&limit=1&select=*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.length > 0 ? data[0] : null;
  } catch { return null; }
}

function cleanStrainName(name) {
  if (!name) return name;
  // Remove M-number codes (M followed by 10-12 digits) and optional colon after
  let cleaned = name.replace(/\bM\d{10,12}\b\s*:?\s*/g, '').trim();
  // Remove leading/trailing colons and whitespace
  cleaned = cleaned.replace(/^[\s:]+|[\s:]+$/g, '').trim();
  // If format has " - " segments, find the most strain-like one
  const parts = cleaned.split(' - ');
  if (parts.length >= 3) {
    const skipPat = /^\d+\.?\d*$|ssu|bulk|raw|inf\b|flower|pre.?roll|\d+(mg|g|pk)|\b(llc|inc|ohio|farms|cannabis|wellness|labs?)\b/i;
    const strainPart = parts.find(p => !skipPat.test(p.trim()) && p.trim().length >= 3 && /[A-Za-z]{2,}/.test(p));
    if (strainPart) return strainPart.trim();
    return parts[parts.length - 1].trim();
  }
  // Remove trailing " by Brand" attribution
  cleaned = cleaned.replace(/\s+by\s+.+$/i, '').trim();
  return cleaned;
}

function scanRowToCoaData(row) {
  let terpenes = row.terpenes || [];
  if (typeof terpenes === 'string') { try { terpenes = JSON.parse(terpenes); } catch { terpenes = []; } }
  return {
    product_name: cleanStrainName(row.strain),
    cultivator: row.cultivator,
    batch_number: row.batch_number,
    lab_name: row.lab_name,
    thc: row.thc,
    cbd: row.cbd,
    total_terpenes: row.total_terpenes,
    terpenes,
    pesticides: row.pesticides ? { status: row.pesticides } : null,
    microbials: row.microbials ? { status: row.microbials } : null,
    mycotoxins: row.mycotoxins ? { status: row.mycotoxins } : null,
    moisture: row.moisture,
    water_activity: row.water_activity,
    product_type: row.product_type,
    product_form: row.product_form,
  };
}

// ── Jester Mascot ─────────────────────────────────────────────────────────────

function JesterMascot({ size = 150 }) {
  return (
    <Image source={require('./jester.png')} style={{ width: size, height: size, resizeMode: 'contain' }} />
  );
}

// ── Shared UI Components ───────────────────────────────────────────────────────

function StatBox({ label, value, unit }) {
  const isText = typeof value === 'string' && isNaN(parseFloat(value));
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, isText && { fontSize: 13, textAlign: 'center' }]} numberOfLines={2} adjustsFontSizeToFit>
        {value ?? '—'}{value != null && unit ? unit : ''}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StatusBadge({ label, status }) {
  if (!status) return null;
  const color = status === 'Pass' ? '#FF8C00' : status === 'Fail' ? '#ff6b6b' : '#aaa';
  return (
    <View style={styles.badgeRow}>
      <Text style={styles.badgeLabel}>{label}</Text>
      <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
        <Text style={[styles.badgeText, { color }]}>{status}</Text>
      </View>
    </View>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function CannabisLeaf({ filled, size = 32 }) {
  return <Text style={{ fontSize: size, opacity: filled ? 1 : 0.25 }}>🔥</Text>;
}

function JesterLoader({ message = 'Loading…' }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: '#3D0070' }}>
      <JesterMascot size={90} />
      <ActivityIndicator color="#FF8C00" size="large" />
      <Text style={{ color: '#FFB347', fontFamily: 'FredokaOne_400Regular', fontSize: 15 }}>{message}</Text>
    </View>
  );
}

function StarRating({ value, onChange }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <TouchableOpacity key={i} onPress={() => onChange(i)}>
          <CannabisLeaf filled={i <= value} size={30} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function RatingRow({ label, description, value, onChange }) {
  return (
    <View style={styles.ratingRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.ratingLabel}>{label}</Text>
        <Text style={styles.ratingDesc}>{description}</Text>
      </View>
      <StarRating value={value} onChange={onChange} />
    </View>
  );
}

function MiniLeafRow({ value }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[1,2,3,4,5].map(i => <CannabisLeaf key={i} filled={i <= value} size={16} />)}
    </View>
  );
}

function ReviewCard({ review, userId, username }) {
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);

  function toggleExpand() {
    if (!expanded && review.id) {
      fetchComments(review.id).then(setComments);
    }
    setExpanded(!expanded);
  }

  async function handlePostComment() {
    if (!commentText.trim() || !review.id) return;
    setPosting(true);
    try {
      const newComment = await postComment(review.id, userId, username, commentText.trim());
      setComments(prev => [...prev, newComment]);
      setCommentText('');
    } catch (e) {
      Alert.alert('Error', 'Could not post comment.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={styles.reviewCard}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontSize: 28, fontFamily: 'Cinzel_700Bold', color: '#FF8C00' }}>
          {review.overall ?? '—'}<Text style={{ fontSize: 28, fontFamily: 'Cinzel_700Bold', color: '#FFB347' }}>/5</Text>
        </Text>
        <Text style={[styles.ratingDesc, { marginTop: 0 }]}>{review.created_at ? new Date(review.created_at).toLocaleDateString() : ''}</Text>
      </View>
      {review.aroma > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}><Text style={styles.ratingDesc}>Aroma</Text><MiniLeafRow value={review.aroma} /></View>}
      {review.taste > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}><Text style={styles.ratingDesc}>Taste</Text><MiniLeafRow value={review.taste} /></View>}
      {review.bag_appeal > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}><Text style={styles.ratingDesc}>Bag Appeal</Text><MiniLeafRow value={review.bag_appeal} /></View>}
      {review.moisture_cure > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}><Text style={styles.ratingDesc}>Moisture/Cure</Text><MiniLeafRow value={review.moisture_cure} /></View>}
      {review.effects > 0 && <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}><Text style={styles.ratingDesc}>Effects</Text><MiniLeafRow value={review.effects} /></View>}
      {review.bag_appeal_photo ? <Image source={{ uri: review.bag_appeal_photo }} style={{ width: '100%', height: 180, borderRadius: 8, marginTop: 10 }} resizeMode="cover" /> : null}
      {review.comment ? <Text style={[styles.terpeneText, { marginTop: 8, fontStyle: 'italic' }]}>"{review.comment}"</Text> : null}

      {/* Comments section */}
      <TouchableOpacity onPress={toggleExpand} style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: '#FF8C00', fontFamily: 'FredokaOne_400Regular', fontSize: 13 }}>
          {expanded ? '▲ Hide comments' : `💬 Comments${comments.length > 0 ? ` (${comments.length})` : ''}`}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 10 }}>
          {comments.length === 0 && <Text style={{ color: '#FF8C00', fontSize: 12, fontStyle: 'italic', fontFamily: 'FredokaOne_400Regular' }}>No comments yet.</Text>}
          {comments.map((c, i) => (
            <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: '#FF8C00', paddingLeft: 10, marginBottom: 8 }}>
              {c.username ? <Text style={{ color: '#00C853', fontSize: 12, fontFamily: 'Cinzel_700Bold', marginBottom: 2 }}>@{c.username}</Text> : null}
              <Text style={{ color: '#FF8C00', fontSize: 13 }}>{c.comment}</Text>
              <Text style={{ color: '#FFB347', fontSize: 11, marginTop: 2 }}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1, paddingVertical: 8, fontSize: 13, color: '#FF8C00' }]}
              placeholder="Add a comment..."
              placeholderTextColor="#FFB347"
              value={commentText}
              onChangeText={setCommentText}
              multiline
            />
            <TouchableOpacity onPress={handlePostComment} disabled={posting || !commentText.trim()}
              style={{ backgroundColor: '#7B3FBB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, opacity: posting || !commentText.trim() ? 0.5 : 1 }}>
              {posting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontFamily: 'FredokaOne_400Regular' }}>Post</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Product Result Tabs ────────────────────────────────────────────────────────

function LabResultsTab({ data }) {
  const { thc, cbd, batch_number, terpenes, total_terpenes, product_name, cultivator, lab_name,
          heavy_metals, pesticides, microbials, mycotoxins, moisture, water_activity,
          product_form } = data;
  const topTerpenes = terpenes ? terpenes.slice(0, 5) : [];

  return (
    <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + 16 }}>
      {(product_name || cultivator) && (
        <Text style={styles.productName}>{product_name}{cultivator ? ` - ${cultivator}` : ''}</Text>
      )}
      {lab_name && <Text style={styles.labName}>Lab: {lab_name}</Text>}
      <View style={styles.statsRow}>
        <StatBox label="Total THC" value={thc} unit="%" />
        {product_form
          ? <StatBox label="Product Form" value={product_form} unit="" />
          : <StatBox label="Total CBD" value={cbd} unit="%" />}
        <StatBox label="Total Terpenes" value={total_terpenes} unit="%" />
      </View>
      {batch_number && (
        <View style={[styles.terpeneRow, { marginBottom: 16, paddingHorizontal: 4 }]}>
          <Text style={[styles.terpeneText, { color: '#aaa' }]}>Batch #</Text>
          <Text style={styles.terpeneText}>{batch_number}</Text>
        </View>
      )}
      <Section title="Safety Tests">
        <StatusBadge label="Heavy Metals" status={heavy_metals?.length > 0 ? (heavy_metals.every(m => m.status === 'Passed') ? 'Pass' : 'Fail') : null} />
        <StatusBadge label="Pesticides" status={pesticides?.status} />
        <StatusBadge label="Microbials" status={microbials?.status} />
        <StatusBadge label="Mycotoxins" status={mycotoxins?.status} />
      </Section>
      {topTerpenes?.length > 0 && (
        <Section title="Terpenes">
          {topTerpenes.map((t, i) => (
            <View key={i} style={styles.terpeneRow}>
              <Text style={styles.terpeneText}>{t.name.replace(/\s*\(\d+\)\s*$/, '')}</Text>
              {t.percentage && <Text style={styles.terpeneText}>{t.percentage}%</Text>}
            </View>
          ))}
        </Section>
      )}
      {(moisture || water_activity) && (
        <Section title="Moisture">
          {moisture && <View style={styles.terpeneRow}><Text style={styles.terpeneText}>Moisture Content</Text><Text style={styles.terpeneText}>{moisture}%</Text></View>}
          {water_activity && <View style={styles.terpeneRow}><Text style={styles.terpeneText}>Water Activity</Text><Text style={styles.terpeneText}>{water_activity} aw</Text></View>}
          <View style={styles.terpeneRow}><Text style={[styles.terpeneText, { color: '#FFB347', fontSize: 12, fontStyle: 'italic' }]}>Ideal range: 10–12% moisture</Text></View>
        </Section>
      )}
    </ScrollView>
  );
}

function ReviewsTab({ data, userId, username }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReviews(data.product_name, data.cultivator).then(setReviews).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <View style={{ alignItems: 'center', marginTop: 80, gap: 16 }}>
      <JesterMascot size={90} />
      <ActivityIndicator color="#FF8C00" size="large" />
      <Text style={{ color: '#FFB347', fontFamily: 'FredokaOne_400Regular', fontSize: 15 }}>Loading reviews…</Text>
    </View>
  );

  if (reviews.length === 0) return (
    <View style={styles.center}>
      <Text style={[styles.labName, { textAlign: 'center' }]}>No reviews yet.{'\n'}Be the first to rate this product!</Text>
    </View>
  );

  const avgOverall = (reviews.reduce((sum, r) => sum + (r.overall || 0), 0) / reviews.length).toFixed(1);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={120}>
      <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 20 }}>
          <Text style={{ fontSize: 56, fontFamily: 'Cinzel_700Bold', color: '#FF8C00' }}>
            {avgOverall}<Text style={{ fontSize: 56, fontFamily: 'Cinzel_700Bold', color: '#FFB347' }}>/5</Text>
          </Text>
          <Text style={styles.ratingDesc}>{reviews.length} review{reviews.length !== 1 ? 's' : ''}</Text>
        </View>
        {reviews.map((r, i) => <ReviewCard key={i} review={r} userId={userId} username={username} />)}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RateItTab({ data, userId, username, onSubmitted }) {
  const [ratings, setRatings] = useState({ aroma: 0, taste: 0, bag_appeal: 0, moisture_cure: 0, effects: 0 });
  const [comment, setComment] = useState('');
  const [bagPhoto, setBagPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function setRating(key, val) { setRatings(r => ({ ...r, [key]: val })); }

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Please allow photo access.'); return; }
    Alert.alert('Add Photo', 'Choose an option', [
      { text: 'Take Photo', onPress: async () => {
        const cam = await ImagePicker.requestCameraPermissionsAsync();
        if (cam.status !== 'granted') return;
        const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [4, 3], base64: true });
        if (!result.canceled) setBagPhoto({ uri: result.assets[0].uri, base64: result.assets[0].base64 });
      }},
      { text: 'Choose from Library', onPress: async () => {
        const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [4, 3], base64: true });
        if (!result.canceled) setBagPhoto({ uri: result.assets[0].uri, base64: result.assets[0].base64 });
      }},
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleSubmit() {
    const filled = Object.values(ratings).filter(v => v > 0);
    if (filled.length === 0) { Alert.alert('Required', 'Please rate at least one category.'); return; }
    const overall = Math.round(filled.reduce((a, b) => a + b, 0) / filled.length);
    setSubmitting(true);
    try {
      let bag_appeal_photo = null;
      if (bagPhoto) bag_appeal_photo = await uploadPhoto(bagPhoto.base64);
      await submitReview({ strain: data.product_name, cultivator: data.cultivator, batch_number: data.batch_number, username, product_type: data.product_type || null, ...ratings, overall, comment: comment.trim() || null, bag_appeal_photo }, userId);
      setSubmitted(true);
      onSubmitted();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not submit review.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) return (
    <View style={styles.center}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>🍃</Text>
      <Text style={[styles.productName, { textAlign: 'center' }]}>Review Submitted!</Text>
      <Text style={styles.labName}>Thanks for helping the community.</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + 16 }} keyboardShouldPersistTaps="handled">
        <RatingRow label="Aroma" description="How does it smell straight from the jar?" value={ratings.aroma} onChange={v => setRating('aroma', v)} />
        <RatingRow label="Taste/Flavor" description="How does it taste on the inhale and exhale?" value={ratings.taste} onChange={v => setRating('taste', v)} />
        <RatingRow label="Bag Appeal" description="How does it look? Trichomes, trim, bud structure" value={ratings.bag_appeal} onChange={v => setRating('bag_appeal', v)} />
        <TouchableOpacity onPress={handlePickPhoto} style={styles.photoBtn}>
          {bagPhoto ? <Image source={{ uri: bagPhoto.uri }} style={styles.photoThumb} /> : <Text style={styles.photoBtnText}>📷  Add Bag Appeal Photo</Text>}
          {bagPhoto && <Text style={[styles.ratingDesc, { marginTop: 4, textAlign: 'center' }]}>Tap to change</Text>}
        </TouchableOpacity>
        <RatingRow label="Moisture/Cure" description="Is it properly cured? Not too dry, not too wet" value={ratings.moisture_cure} onChange={v => setRating('moisture_cure', v)} />
        <RatingRow label="Effects" description="How strong and long-lasting were the effects?" value={ratings.effects} onChange={v => setRating('effects', v)} />
        <View style={[styles.section, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Comments</Text>
          <TextInput style={styles.commentInput} placeholder="Describe harshness, effects, anything else..." placeholderTextColor="#7B3FBB" multiline numberOfLines={4} value={comment} onChangeText={setComment} />
        </View>
        <TouchableOpacity style={[styles.button, { marginTop: 8, opacity: submitting ? 0.6 : 1 }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#3D0070" /> : <Text style={styles.buttonText}>Submit Review</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Bottom Tab Bar ─────────────────────────────────────────────────────────────

function BottomTabBar({ activeTab, onTabChange }) {
  const insets = useSafeAreaInsets();
  const tabs = [
    { id: 'home', icon: '🏠', label: 'Home' },
    { id: 'analytics', icon: '📊', label: 'Scan History' },
    { id: 'profile', icon: '👤', label: 'Profile' },
  ];
  return (
    <View style={[styles.bottomTabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map(tab => (
        <TouchableOpacity key={tab.id} style={styles.bottomTabItem} onPress={() => onTabChange(tab.id)}>
          <Text style={{ fontSize: 22 }}>{tab.icon}</Text>
          <Text style={[styles.bottomTabLabel, activeTab === tab.id && styles.bottomTabLabelActive]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Home Tab ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function BatchReviewCard({ group, onPress }) {
  const [expanded, setExpanded] = useState(false);
  const { strain, cultivator, batch_number, reviews } = group;
  const avg = (reviews.reduce((a, r) => a + (r.overall || 0), 0) / reviews.length).toFixed(1);
  const latest = reviews[0];

  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}>
      {/* Header — tap to expand/collapse */}
      <TouchableOpacity onPress={() => setExpanded(e => !e)} style={{ padding: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <Text style={{ fontFamily: 'FredokaOne_400Regular', fontSize: 15, color: '#FF8C00', flex: 1 }}>{strain}</Text>
          <Text style={{ fontFamily: 'Cinzel_700Bold', fontSize: 14, color: '#00C853' }}>{avg}/5</Text>
        </View>
        {cultivator ? <Text style={[{ color: '#BBB', fontSize: 11, fontFamily: 'FredokaOne_400Regular' }]}>{cultivator}</Text> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          {batch_number ? <Text style={{ color: '#7B3FBB', fontSize: 10, fontFamily: 'FredokaOne_400Regular' }}>Batch {batch_number.slice(-6)}</Text> : <Text />}
          <Text style={{ color: '#FFB347', fontSize: 11, fontFamily: 'FredokaOne_400Regular' }}>{reviews.length} review{reviews.length !== 1 ? 's' : ''}  {expanded ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {/* Expanded reviews */}
      {expanded && (
        <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' }}>
          {reviews.map((r, i) => (
            <View key={i} style={{ padding: 12, borderBottomWidth: i < reviews.length - 1 ? 1 : 0, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontFamily: 'FredokaOne_400Regular', fontSize: 13, color: '#00C853' }}>{r.username || 'Anonymous'}</Text>
                <Text style={{ fontFamily: 'Cinzel_700Bold', fontSize: 13, color: '#00C853' }}>{r.overall}/5</Text>
              </View>
              {r.comment ? <Text style={{ color: '#DDD', fontSize: 12, fontFamily: 'FredokaOne_400Regular', marginBottom: 4 }}>{r.comment}</Text> : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#888', fontSize: 10, fontFamily: 'FredokaOne_400Regular' }}>{timeAgo(r.created_at)}</Text>
                {r.bag_appeal_photo ? <Text style={{ color: '#FF8C00', fontSize: 10, fontFamily: 'FredokaOne_400Regular' }}>📷 Photo</Text> : null}
              </View>
            </View>
          ))}
          {/* Tap to see full strain card */}
          <TouchableOpacity onPress={onPress} style={{ padding: 10, alignItems: 'center', backgroundColor: 'rgba(255,140,0,0.1)' }}>
            <Text style={{ color: '#FF8C00', fontFamily: 'FredokaOne_400Regular', fontSize: 13 }}>View Lab Results →</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function HomeTab({ username, onScan, onSelectScan }) {
  const insets = useSafeAreaInsets();
  const [trending, setTrending] = useState({ top: [], bottom: [] });
  const [feed, setFeed] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');

  useEffect(() => {
    fetchTrendingStrains(activeCategory).then(setTrending);
    fetchCommunityFeed(activeCategory).then(setFeed);
  }, [activeCategory]);

  async function handleStrainPress(strain) {
    const scanData = await fetchScanByStrain(strain);
    if (scanData && onSelectScan) onSelectScan(scanData);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#3D0070' }} edges={['top']}>
      <View style={styles.homeHeader}>
        <View>
          <Text style={styles.welcomeText}>Hey, {username}!</Text>
          <Text style={[styles.ratingDesc, { marginTop: 2 }]}>Ready to scan?</Text>
        </View>
        <JesterMascot size={50} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 56 + 16 }}>
        {/* Scan Button */}
        <TouchableOpacity style={styles.scanButton} onPress={onScan} activeOpacity={0.85}>
          <Text style={{ fontSize: 48 }}>📷</Text>
          <Text style={styles.scanButtonText}>SCAN QR CODE</Text>
          <Text style={[styles.ratingDesc, { marginTop: 4 }]}>Point your camera at a COA QR code</Text>
        </TouchableOpacity>

        {/* Category filter tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {CATEGORY_TABS.map(tab => (
            <TouchableOpacity key={tab} onPress={() => setActiveCategory(tab)}
              style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                backgroundColor: activeCategory === tab ? '#FF8C00' : 'rgba(255,255,255,0.1)',
                borderWidth: 1, borderColor: activeCategory === tab ? '#FF8C00' : 'rgba(255,255,255,0.2)' }}>
              <Text style={{ fontFamily: 'FredokaOne_400Regular', fontSize: 13,
                color: activeCategory === tab ? '#fff' : '#FFB347' }}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Top Rated */}
        {trending.top.length > 0 && (
          <View style={[styles.section, { marginTop: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <JesterMascot size={22} />
              <Text style={styles.sectionTitle}>Fool's Fire</Text>
            </View>
            <Text style={[styles.ratingDesc, { marginBottom: 10 }]}>Highest rated by the community</Text>
            {trending.top.map((item, i) => (
              <TouchableOpacity key={i} onPress={() => handleStrainPress(item.strain)} style={[styles.terpeneRow, { alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, fontFamily: 'FredokaOne_400Regular', color: '#FF8C00' }}>{item.strain}</Text>
                  {item.cultivator ? <Text style={[styles.ratingDesc, { fontSize: 11 }]}>{item.cultivator}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: 'Cinzel_700Bold', fontSize: 16, color: '#00C853' }}>{item.avg}/5</Text>
                  <Text style={[styles.ratingDesc, { fontSize: 11 }]}>{item.count} review{item.count !== 1 ? 's' : ''}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Lowest Rated */}
        {trending.bottom.length > 0 && (
          <View style={[styles.section, { marginTop: 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <JesterMascot size={22} />
              <Text style={styles.sectionTitle}>Fool's Choice</Text>
            </View>
            <Text style={[styles.ratingDesc, { marginBottom: 10 }]}>Lowest rated by the community</Text>
            {trending.bottom.map((item, i) => (
              <TouchableOpacity key={i} onPress={() => handleStrainPress(item.strain)} style={[styles.terpeneRow, { alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, fontFamily: 'FredokaOne_400Regular', color: '#FF8C00' }}>{item.strain}</Text>
                  {item.cultivator ? <Text style={[styles.ratingDesc, { fontSize: 11 }]}>{item.cultivator}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: 'Cinzel_700Bold', fontSize: 16, color: '#ff6b6b' }}>{item.avg}/5</Text>
                  <Text style={[styles.ratingDesc, { fontSize: 11 }]}>{item.count} review{item.count !== 1 ? 's' : ''}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {trending.top.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 24 }}>
            <Text style={[styles.ratingDesc, { textAlign: 'center' }]}>No community ratings yet.{'\n'}Be the first to rate a product!</Text>
          </View>
        )}

        {/* Community Feed — grouped by batch */}
        {feed.length > 0 && (
          <View style={[styles.section, { marginTop: 8 }]}>
            <Text style={[styles.sectionTitle, { marginBottom: 10 }]}>Community Reviews</Text>
            {feed.map((group, i) => (
              <BatchReviewCard key={i} group={group} onPress={() => handleStrainPress(group.strain)} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}


// ── Analytics Tab ──────────────────────────────────────────────────────────────

const CATEGORY_TABS = ['All', 'Flower', 'Pre-Roll', 'Concentrate', 'Vaporizer'];

function getScanCategory(scan) {
  if (scan.product_type) return scan.product_type;
  // Fallback for old scans without product_type — check raw_title first
  const rt = (scan.raw_title || '').toLowerCase();
  if (/\blp\b|luster.?pod|vape.?cart|cartridge|\bcart\b|disposable/.test(rt)) return 'Vaporizer';
  if (/\bssu\b|single.?serving|pre.?roll|\bcones?\b/.test(rt)) {
    return /\binf\b|infused/.test(rt) ? 'Infused Pre-Roll' : 'Pre-Roll';
  }
  if (scan.thc && parseFloat(scan.thc) > 50) return 'Concentrate';
  return 'Flower';
}

function AnalyticsTab({ history, historyLoading, userId, onSelectScan }) {
  const [topRated, setTopRated] = useState(null);
  const [strainRatings, setStrainRatings] = useState(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom + 56 + 16;

  useEffect(() => {
    fetchUserTopRated(userId).then(setTopRated);
  }, []);

  useEffect(() => {
    setStrainRatings(null);
    if (history.length === 0) { setStrainRatings({}); return; }
    const strains = [...new Set(history.map(s => s.strain).filter(Boolean))];
    const filter = strains.map(s => `strain.eq.${encodeURIComponent(s)}`).join(',');
    fetch(`${SUPABASE_URL}/rest/v1/REVIEWS?select=strain,overall&or=(${filter})&limit=500`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
      .then(r => r.json())
      .then(rows => {
        const map = {};
        rows.forEach(r => {
          if (!map[r.strain]) map[r.strain] = [];
          map[r.strain].push(parseFloat(r.overall));
        });
        const avgs = {};
        Object.entries(map).forEach(([strain, scores]) => {
          avgs[strain] = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
        });
        setStrainRatings(avgs);
      })
      .catch(() => setStrainRatings({}));
  }, [history]);

  const strainGroups = useMemo(() =>
    Object.values(
      history.reduce((g, item) => {
        const key = item.strain || 'Unknown Strain';
        if (!g[key]) g[key] = [];
        g[key].push(item);
        return g;
      }, {})
    ).sort((a, b) => new Date(b[0].created_at) - new Date(a[0].created_at)),
  [history]);

  const filteredGroups = useMemo(() => {
    if (activeCategory === 'All') return strainGroups;
    const categoryFiltered = activeCategory === 'All' ? strainGroups : strainGroups.filter(scans => {
      const cat = getScanCategory(scans[0]);
      if (activeCategory === 'Pre-Roll') return cat === 'Pre-Roll' || cat === 'Infused Pre-Roll';
      return cat === activeCategory;
    });
    if (!searchQuery.trim()) return categoryFiltered;
    const q = searchQuery.toLowerCase();
    return categoryFiltered.filter(scans =>
      (scans[0].strain || '').toLowerCase().includes(q) ||
      (scans[0].cultivator || '').toLowerCase().includes(q)
    );
  }, [strainGroups, activeCategory, searchQuery]);

  const scansWithTHC = history.filter(s => s.thc != null && s.thc > 0);
  const scansWithCBD = history.filter(s => s.cbd != null && s.cbd > 0);
  const scansWithTerps = history.filter(s => s.total_terpenes != null && s.total_terpenes > 0);
  const avgTHC = scansWithTHC.length > 0
    ? (scansWithTHC.reduce((s, r) => s + parseFloat(r.thc), 0) / scansWithTHC.length).toFixed(1) : null;
  const avgCBD = scansWithCBD.length > 0
    ? (scansWithCBD.reduce((s, r) => s + parseFloat(r.cbd), 0) / scansWithCBD.length).toFixed(2) : null;
  const avgTerps = scansWithTerps.length > 0
    ? (scansWithTerps.reduce((s, r) => s + parseFloat(r.total_terpenes), 0) / scansWithTerps.length).toFixed(2) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#3D0070' }} edges={['top']}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: bottomPad }}>
        <Text style={[styles.welcomeText, { marginBottom: 12 }]}>Scan History</Text>

        {/* Search bar */}
        <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 12 }}>
          <Text style={{ color: '#FFB347', fontSize: 16, marginRight: 8 }}>🔍</Text>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search strains or cultivators..."
            placeholderTextColor="rgba(255,179,71,0.5)"
            style={{ flex: 1, color: '#fff', fontFamily: 'FredokaOne_400Regular', fontSize: 14, paddingVertical: 10 }}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={{ color: '#FFB347', fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Category filter tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {CATEGORY_TABS.map(tab => (
            <TouchableOpacity key={tab} onPress={() => setActiveCategory(tab)}
              style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                backgroundColor: activeCategory === tab ? '#FF8C00' : 'rgba(255,255,255,0.1)',
                borderWidth: 1, borderColor: activeCategory === tab ? '#FF8C00' : 'rgba(255,255,255,0.2)' }}>
              <Text style={{ fontFamily: 'FredokaOne_400Regular', fontSize: 13,
                color: activeCategory === tab ? '#fff' : '#FFB347' }}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {historyLoading || strainRatings === null ? (
          <View style={{ alignItems: 'center', marginTop: 80, gap: 16 }}>
            <JesterMascot size={90} />
            <ActivityIndicator color="#FF8C00" size="large" />
            <Text style={{ color: '#FFB347', fontFamily: 'FredokaOne_400Regular', fontSize: 15 }}>Loading your stash…</Text>
          </View>
        ) : history.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Text style={styles.ratingDesc}>No scans yet.</Text>
            <Text style={[styles.ratingDesc, { marginTop: 4 }]}>Head to Home and scan your first product!</Text>
          </View>
        ) : (
          <>
            {/* Group by strain — one card per unique strain */}
            {(() => {
              const groups = filteredGroups;
              // Find top and lowest rated among rated strains
              const ratedStrains = Object.entries(strainRatings);
              const topStrain = ratedStrains.length > 0
                ? ratedStrains.reduce((a, b) => parseFloat(a[1]) >= parseFloat(b[1]) ? a : b)[0] : null;
              const lowStrain = ratedStrains.length > 1
                ? ratedStrains.reduce((a, b) => parseFloat(a[1]) <= parseFloat(b[1]) ? a : b)[0] : null;

              if (groups.length === 0) return (
                <View style={{ alignItems: 'center', marginTop: 40 }}>
                  <Text style={styles.ratingDesc}>No {activeCategory} scans yet.</Text>
                </View>
              );

              return groups.map((scans, i) => {
                const latest = scans[0];
                const isTopRated = latest.strain === topStrain;
                const isLowestRated = latest.strain === lowStrain;
                const borderColor = '#7B3FBB';
                const coaData = {
                  ...scanRowToCoaData(latest),
                  _analytics: { avgTHC, avgCBD, avgTerps, totalScans: history.length, isTopRated, topRatedScore: topRated?.overall,
                    strainHistory: scans.slice().reverse() },
                };
                return (
                  <TouchableOpacity key={i} onPress={() => onSelectScan(coaData)}
                    style={[styles.historyItem, { flexDirection: 'column', gap: 4, borderColor }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.historyStrain}>{latest.strain || 'Unknown Strain'}</Text>
                      {isTopRated && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,140,0,0.15)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <JesterMascot size={18} />
                          <Text style={{ fontSize: 10, color: '#FF8C00', fontFamily: 'FredokaOne_400Regular' }}>Fool's Fire</Text>
                        </View>
                      )}
                      {isLowestRated && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,215,0,0.15)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <JesterMascot size={18} />
                          <Text style={{ fontSize: 10, color: '#FFD700', fontFamily: 'FredokaOne_400Regular' }}>Fool's Choice</Text>
                        </View>
                      )}
                    </View>
                    {latest.cultivator ? <Text style={styles.ratingDesc}>{latest.cultivator}</Text> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <Text style={[styles.ratingDesc, { fontSize: 12 }]}>{scans.length} scan{scans.length !== 1 ? 's' : ''}</Text>
                      {strainRatings[latest.strain] != null && (
                        <>
                          <Text style={[styles.ratingDesc, { fontSize: 12 }]}>·</Text>
                          <Text style={{ fontFamily: 'Cinzel_700Bold', fontSize: 13, color: '#FF8C00' }}>🔥 {strainRatings[latest.strain]}/5</Text>
                        </>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              });
            })()}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Profile Tab ────────────────────────────────────────────────────────────────

function ProfileTab({ username, userId, scanHistory, onSignOut }) {
  const insets = useSafeAreaInsets();
  const [reviewCount, setReviewCount] = useState(null);

  useEffect(() => {
    if (!userId) return;
    fetch(`${SUPABASE_URL}/rest/v1/REVIEWS?device_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' } }
    ).then(r => {
      const count = r.headers.get('content-range')?.split('/')[1];
      setReviewCount(count ? parseInt(count) : 0);
    }).catch(() => setReviewCount(0));
  }, [userId]);

  const totalScans = scanHistory.length;
  const uniqueStrains = new Set(scanHistory.map(s => s.strain).filter(Boolean)).size;
  const scansWithTHC = scanHistory.filter(s => s.thc > 0);
  const avgTHC = scansWithTHC.length > 0
    ? (scansWithTHC.reduce((a, b) => a + parseFloat(b.thc), 0) / scansWithTHC.length).toFixed(1) : null;
  const topStrain = scanHistory.length > 0 ? scanHistory[0].strain : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#3D0070' }} edges={['top']}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 72 }}>
        <Text style={[styles.welcomeText, { marginBottom: 24 }]}>Profile</Text>

        {/* Account */}
        <View style={[styles.section, { marginBottom: 16 }]}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.terpeneRow}>
            <Text style={styles.terpeneText}>Username</Text>
            <Text style={[styles.terpeneText, { color: '#00C853' }]}>@{username}</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={[styles.section, { marginBottom: 16 }]}>
          <Text style={styles.sectionTitle}>Your Stats</Text>
          <View style={styles.terpeneRow}>
            <Text style={styles.terpeneText}>Total Scans</Text>
            <Text style={[styles.terpeneText, { color: '#FF8C00' }]}>{totalScans}</Text>
          </View>
          <View style={styles.terpeneRow}>
            <Text style={styles.terpeneText}>Unique Strains</Text>
            <Text style={[styles.terpeneText, { color: '#FF8C00' }]}>{uniqueStrains}</Text>
          </View>
          {reviewCount !== null && (
            <View style={styles.terpeneRow}>
              <Text style={styles.terpeneText}>Reviews Left</Text>
              <Text style={[styles.terpeneText, { color: '#FF8C00' }]}>{reviewCount}</Text>
            </View>
          )}
          {avgTHC && (
            <View style={styles.terpeneRow}>
              <Text style={styles.terpeneText}>Avg THC Scanned</Text>
              <Text style={[styles.terpeneText, { color: '#FF8C00' }]}>{avgTHC}%</Text>
            </View>
          )}
          {topStrain && (
            <View style={styles.terpeneRow}>
              <Text style={styles.terpeneText}>Most Recent Strain</Text>
              <Text style={[styles.terpeneText, { color: '#FF8C00', flex: 1, textAlign: 'right' }]} numberOfLines={1}>{topStrain}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: '#5A1A99', borderWidth: 1, borderColor: '#ff6b6b' }]}
          onPress={() => Alert.alert('Log Out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log Out', style: 'destructive', onPress: onSignOut },
          ])}
        >
          <Text style={[styles.buttonText, { color: '#ff6b6b' }]}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Auth Screen ────────────────────────────────────────────────────────────────

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleAuth() {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Required', 'Please enter your username and password.');
      return;
    }
    if (mode === 'signup' && !email.trim()) {
      Alert.alert('Required', 'Please enter your email address.');
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      Alert.alert("Passwords don't match", 'Please make sure both passwords are the same.');
      return;
    }
    const internalEmail = `${username.trim().toLowerCase()}@cannafool.app`;
    setLoading(true);
    try {
      let result;
      if (mode === 'signup') {
        result = await supabaseSignUp(internalEmail, password, username.trim(), email.trim().toLowerCase());
      } else {
        result = await supabaseSignIn(internalEmail, password);
      }
      const userId = result.user?.id;
      const displayName = result.user?.user_metadata?.username || username.trim();
      await storeUser(userId, displayName, result.access_token);
      onAuthenticated(userId, displayName);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#3D0070' }} edges={['top']}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <Text style={[styles.title, { fontSize: 36, marginBottom: 8 }]}>CannaFool</Text>
          <JesterMascot size={110} />
        </View>

        <View style={{ flexDirection: 'row', marginBottom: 24, backgroundColor: '#5A1A99', borderRadius: 10, padding: 4 }}>
          {['login', 'signup'].map(m => (
            <TouchableOpacity key={m} onPress={() => setMode(m)}
              style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: mode === m ? '#00C853' : 'transparent' }}>
              <Text style={{ fontFamily: 'FredokaOne_400Regular', fontSize: 15, color: mode === m ? '#3D0070' : '#7B3FBB' }}>
                {m === 'login' ? 'Log In' : 'Sign Up'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput style={styles.authInput} placeholder="Username" placeholderTextColor="#FFB347"
          value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} />

        {mode === 'signup' && (
          <TextInput style={styles.authInput} placeholder="Email" placeholderTextColor="#FFB347"
            value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        )}

        <View style={{ position: 'relative' }}>
          <TextInput style={[styles.authInput, { paddingRight: 48 }]} placeholder="Password" placeholderTextColor="#FFB347"
            value={password} onChangeText={setPassword} secureTextEntry={!showPassword} />
          <TouchableOpacity onPress={() => setShowPassword(v => !v)}
            style={{ position: 'absolute', right: 14, top: 0, bottom: 12, justifyContent: 'center' }}>
            <Text style={{ fontSize: 20 }}>{showPassword ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>

        {mode === 'signup' && (
          <View style={{ position: 'relative' }}>
            <TextInput style={[styles.authInput, { paddingRight: 48, borderColor: confirmPassword && confirmPassword !== password ? '#ff6b6b' : '#7B3FBB' }]}
              placeholder="Confirm Password" placeholderTextColor="#FFB347"
              value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry={!showConfirm} />
            <TouchableOpacity onPress={() => setShowConfirm(v => !v)}
              style={{ position: 'absolute', right: 14, top: 0, bottom: 12, justifyContent: 'center' }}>
              <Text style={{ fontSize: 20 }}>{showConfirm ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={[styles.button, { marginTop: 8, opacity: loading ? 0.6 : 1 }]} onPress={handleAuth} disabled={loading}>
          {loading ? <ActivityIndicator color="#3D0070" /> : <Text style={styles.buttonText}>{mode === 'login' ? 'Log In' : 'Create Account'}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Scanner Screen ─────────────────────────────────────────────────────────────

function ScannerScreen({ userId, onResult, onBack }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const scannedRef = useRef(false);

  async function handleBarcodeScan({ data: url }) {
    if (scannedRef.current || loading) return;
    scannedRef.current = true;
    setLoading(true);
    try {
      const coaData = await parseCOA(url, userId);
      onResult(coaData);
    } catch (err) {
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

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#3D0070', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
        <JesterMascot size={90} />
        <ActivityIndicator color="#FF8C00" size="large" />
        <Text style={{ color: '#FFB347', fontFamily: 'FredokaOne_400Regular', fontSize: 15 }}>Reading COA…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" onBarcodeScanned={handleBarcodeScan} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} />
      <View style={styles.overlay}>
        <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 16 }}>
        <View style={{ marginTop: 12 }}>
          <TouchableOpacity onPress={onBack} style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: '#FF8C00', fontFamily: 'FredokaOne_400Regular', fontSize: 14 }}>← Back</Text>
          </TouchableOpacity>
        </View>
        </SafeAreaView>
        <Text style={[styles.title, { fontSize: 34, marginBottom: 4 }]}>CannaFool</Text>
        <JesterMascot size={110} />
        <View style={styles.viewfinder} />
        <Text style={styles.hint}>Point at a COA QR code</Text>
      </View>
    </View>
  );
}

// ── Stats Tab (inside strain detail) ──────────────────────────────────────────

function StatsTab({ data, analytics }) {
  const { thc, cbd, terpenes, total_terpenes } = data;
  const topTerpenes = terpenes ? terpenes.slice(0, 6) : [];
  const strainHistory = analytics?.strainHistory || [];
  const thcHistory = strainHistory.filter(s => s.thc != null && s.thc > 0);
  const terpsHistory = strainHistory.filter(s => s.total_terpenes != null && s.total_terpenes > 0);
  const maxTHC = thcHistory.length > 0 ? Math.max(...thcHistory.map(s => parseFloat(s.thc))) : 1;
  const maxTerps = terpsHistory.length > 0 ? Math.max(...terpsHistory.map(s => parseFloat(s.total_terpenes))) : 1;

  return (
    <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + 16 }}>

      {/* Your averages */}
      {analytics && (
        <View style={[styles.section, { marginBottom: 16 }]}>
          <Text style={styles.sectionTitle}>Your Averages</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <View style={[styles.statBox, { flex: 1 }]}>
              <Text style={styles.statValue}>{analytics.avgTHC ?? '—'}{analytics.avgTHC ? '%' : ''}</Text>
              <Text style={styles.statLabel}>Avg THC</Text>
            </View>
            <View style={[styles.statBox, { flex: 1 }]}>
              <Text style={styles.statValue}>{analytics.avgCBD ?? '—'}{analytics.avgCBD ? '%' : ''}</Text>
              <Text style={styles.statLabel}>Avg CBD</Text>
            </View>
            <View style={[styles.statBox, { flex: 1 }]}>
              <Text style={styles.statValue}>{analytics.avgTerps ?? '—'}{analytics.avgTerps ? '%' : ''}</Text>
              <Text style={styles.statLabel}>Avg Terps</Text>
            </View>
          </View>
          {analytics.isTopRated && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
              <Text style={{ fontSize: 18 }}>⭐</Text>
              <Text style={{ fontFamily: 'FredokaOne_400Regular', fontSize: 13, color: '#FF8C00' }}>Your top rated strain — {analytics.topRatedScore}/5</Text>
            </View>
          )}
        </View>
      )}

      {/* THC % over time */}
      {thcHistory.length > 0 && (
        <View style={[styles.section, { marginBottom: 16 }]}>
          <Text style={styles.sectionTitle}>THC % Over Time</Text>
          <Text style={[styles.ratingDesc, { marginBottom: 12, marginTop: 4 }]}>Batch consistency across your scans of this strain</Text>
          {thcHistory.map((scan, i) => {
            const barWidth = (parseFloat(scan.thc) / maxTHC) * 100;
            const isThisScan = scan.thc === thc;
            return (
              <View key={i} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={[styles.ratingDesc, { fontSize: 11 }]}>{scan.created_at ? new Date(scan.created_at).toLocaleDateString() : `Scan ${i + 1}`}</Text>
                  <Text style={{ fontFamily: 'FredokaOne_400Regular', fontSize: 12, color: isThisScan ? '#FF8C00' : '#00C853' }}>
                    {scan.thc}%{isThisScan ? '  ← this scan' : ''}
                  </Text>
                </View>
                <View style={{ height: 12, backgroundColor: '#2A0050', borderRadius: 6 }}>
                  <View style={{ height: 12, width: `${barWidth}%`, backgroundColor: isThisScan ? '#FF8C00' : '#00C853', borderRadius: 6 }} />
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Terpene % over time */}
      {terpsHistory.length > 0 && (
        <View style={[styles.section, { marginBottom: 16 }]}>
          <Text style={styles.sectionTitle}>Total Terpenes % Over Time</Text>
          <Text style={[styles.ratingDesc, { marginBottom: 12, marginTop: 4 }]}>Terpene richness across your scans of this strain</Text>
          {terpsHistory.map((scan, i) => {
            const barWidth = (parseFloat(scan.total_terpenes) / maxTerps) * 100;
            const isThisScan = scan.total_terpenes === total_terpenes;
            return (
              <View key={i} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={[styles.ratingDesc, { fontSize: 11 }]}>{scan.created_at ? new Date(scan.created_at).toLocaleDateString() : `Scan ${i + 1}`}</Text>
                  <Text style={{ fontFamily: 'FredokaOne_400Regular', fontSize: 12, color: isThisScan ? '#FF8C00' : '#FFB347' }}>
                    {scan.total_terpenes}%{isThisScan ? '  ← this scan' : ''}
                  </Text>
                </View>
                <View style={{ height: 12, backgroundColor: '#2A0050', borderRadius: 6 }}>
                  <View style={{ height: 12, width: `${barWidth}%`, backgroundColor: isThisScan ? '#FF8C00' : '#FFB347', borderRadius: 6 }} />
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Terpene profile for this scan */}
      {topTerpenes.length > 0 && (
        <View style={[styles.section, { marginBottom: 16 }]}>
          <Text style={styles.sectionTitle}>Terpene Profile</Text>
          <Text style={[styles.ratingDesc, { marginBottom: 12, marginTop: 4 }]}>This scan's individual terpenes</Text>
          {topTerpenes.map((t, i) => {
            const barWidth = i === 0 ? 100 : (t.percentage / topTerpenes[0].percentage) * 100;
            return (
              <View key={i} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={styles.terpeneText}>{t.name.replace(/\s*\(\d+\)\s*$/, '')}</Text>
                  <Text style={[styles.ratingDesc, { color: '#00C853' }]}>{t.percentage}%</Text>
                </View>
                <View style={{ height: 12, backgroundColor: '#2A0050', borderRadius: 6 }}>
                  <View style={{ height: 12, width: `${barWidth}%`, backgroundColor: '#00C853', borderRadius: 6 }} />
                </View>
              </View>
            );
          })}
        </View>
      )}

    </ScrollView>
  );
}

// ── Results Screen ─────────────────────────────────────────────────────────────

function ResultsScreen({ data, userId, username, onHome }) {
  const [activeTab, setActiveTab] = useState('lab');
  const analytics = data?._analytics;
  const strainHistory = analytics?.strainHistory || [];
  const [selectedScanIndex, setSelectedScanIndex] = useState(0);

  // Active scan: if multiple scans exist, let user pick; otherwise use data
  const activeScan = strainHistory.length > 1
    ? { ...scanRowToCoaData(strainHistory[selectedScanIndex]), _analytics: analytics }
    : data;

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#3D0070' }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onHome} style={styles.scanAgainBtn}>
            <Text style={styles.scanAgainText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>CannaFool</Text>
          <View style={{ width: 80 }} />
        </View>

        {/* Scan picker — only shown when multiple scans exist */}
        {strainHistory.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={{ backgroundColor: '#2A0050', borderBottomWidth: 1, borderBottomColor: '#5A1A99' }}
            contentContainerStyle={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
            {strainHistory.map((scan, i) => (
              <TouchableOpacity key={i} onPress={() => setSelectedScanIndex(i)}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                  backgroundColor: selectedScanIndex === i ? '#FF8C00' : '#3D0070',
                  borderWidth: 1, borderColor: selectedScanIndex === i ? '#FF8C00' : '#7B3FBB' }}>
                <Text style={{ fontFamily: 'FredokaOne_400Regular', fontSize: 12,
                  color: selectedScanIndex === i ? '#3D0070' : '#FFB347' }}>
                  {scan.created_at ? new Date(scan.created_at).toLocaleDateString() : `Scan ${i + 1}`}
                </Text>
                {scan.thc != null && (
                  <Text style={{ fontFamily: 'Cinzel_400Regular', fontSize: 10,
                    color: selectedScanIndex === i ? '#3D0070' : '#7B3FBB', textAlign: 'center', marginTop: 2 }}>
                    THC {scan.thc}%
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      <View style={styles.tabBar}>
        {['lab', 'stats', 'reviews', 'rate'].map(tab => (
          <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'lab' ? 'Lab Results' : tab === 'stats' ? 'Stats' : tab === 'reviews' ? 'Reviews' : 'Rate It'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'lab' && <LabResultsTab data={activeScan} />}
      {activeTab === 'stats' && <StatsTab data={activeScan} analytics={analytics} />}
      {activeTab === 'reviews' && <ReviewsTab data={activeScan} userId={userId} username={username} />}
      {activeTab === 'rate' && <RateItTab data={activeScan} userId={userId} username={username} onSubmitted={() => setActiveTab('reviews')} />}
    </View>
  );
}

// ── App ────────────────────────────────────────────────────────────────────────

function AppInner() {
  const [screen, setScreen] = useState('loading'); // 'loading' | 'auth' | 'main' | 'scanner' | 'results'
  const [activeTab, setActiveTab] = useState('home');
  const [user, setUser] = useState(null);
  const [coaData, setCoaData] = useState(null);
  const [scanHistory, setScanHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [fontsLoaded] = useFonts({ FredokaOne_400Regular, Cinzel_400Regular, Cinzel_700Bold });

  useEffect(() => {
    async function checkForUpdate() {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch (e) { /* not in EAS environment, ignore */ }
    }
    checkForUpdate();
  }, []);

  useEffect(() => {
    async function checkAuth() {
      const stored = await getStoredUser();
      if (stored?.userId) {
        setUser({ userId: stored.userId, username: stored.username });
        setScreen('main');
      } else {
        setScreen('auth');
      }
    }
    checkAuth();
  }, []);

  useEffect(() => {
    if (screen === 'main' && user) {
      setHistoryLoading(true);
      fetchScanHistory(user.userId)
        .then(setScanHistory)
        .finally(() => setHistoryLoading(false));
    }
  }, [screen, user]);

  async function handleSignOut() {
    await clearUser();
    setUser(null);
    setCoaData(null);
    setScanHistory([]);
    setScreen('auth');
  }

  function handleScanResult(data) {
    setCoaData(data);
    setScreen('results');
    // Refresh history in background after new scan
    if (user) fetchScanHistory(user.userId).then(setScanHistory);
  }

  if (!fontsLoaded || screen === 'loading') return <JesterLoader message="Firing up the fool…" />;

  return (
    <>
      <StatusBar style="light" />

      {screen === 'auth' && (
        <AuthScreen onAuthenticated={(userId, username) => {
          setUser({ userId, username });
          setScreen('main');
        }} />
      )}

      {screen === 'main' && (
        <View style={styles.container}>
          {activeTab === 'home' && (
            <HomeTab
              username={user.username}
              onScan={() => setScreen('scanner')}
              onSelectScan={(data) => { setCoaData(data); setScreen('results'); }}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsTab
              history={scanHistory}
              historyLoading={historyLoading}
              userId={user.userId}
              onSelectScan={(data) => { setCoaData(data); setScreen('results'); }}
            />
          )}
          {activeTab === 'profile' && <ProfileTab username={user.username} userId={user.userId} scanHistory={scanHistory} onSignOut={handleSignOut} />}
          <BottomTabBar activeTab={activeTab} onTabChange={setActiveTab} />
        </View>
      )}

      {screen === 'scanner' && (
        <ScannerScreen userId={user.userId} onResult={handleScanResult} onBack={() => setScreen('main')} />
      )}

      {screen === 'results' && (
        <ResultsScreen data={coaData} userId={user.userId} username={user.username} onHome={() => setScreen('main')} />
      )}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#3D0070' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#3D0070', padding: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#00C853' },
  title: { fontSize: 24, fontFamily: 'FredokaOne_400Regular', color: '#FF8C00' },
  scanAgainBtn: { backgroundColor: '#00C853', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  scanAgainText: { color: '#3D0070', fontFamily: 'FredokaOne_400Regular', fontSize: 13 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#5A1A99' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#FF8C00' },
  tabText: { color: '#7B3FBB', fontFamily: 'FredokaOne_400Regular', fontSize: 13 },
  tabTextActive: { color: '#FF8C00' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewfinder: { width: 240, height: 240, borderWidth: 2, borderColor: '#00C853', borderRadius: 16 },
  hint: { marginTop: 20, color: '#FF8C00', fontFamily: 'FredokaOne_400Regular', fontSize: 14, opacity: 0.9 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 200 },
  loadingText: { color: '#FF8C00', fontFamily: 'FredokaOne_400Regular', fontSize: 16 },
  permissionText: { color: '#FF8C00', fontFamily: 'FredokaOne_400Regular', textAlign: 'center', marginBottom: 20, fontSize: 15 },
  button: { backgroundColor: '#00C853', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#3D0070', fontFamily: 'FredokaOne_400Regular', fontSize: 15 },
  productName: { fontSize: 22, fontFamily: 'FredokaOne_400Regular', color: '#FF8C00', marginBottom: 4 },
  labName: { fontSize: 13, fontFamily: 'Cinzel_400Regular', color: '#FFB347', marginBottom: 20 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, gap: 8 },
  statBox: { flex: 1, backgroundColor: '#5A1A99', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#00C853' },
  statValue: { fontSize: 24, fontFamily: 'Cinzel_700Bold', color: '#FF8C00' },
  statLabel: { fontSize: 11, fontFamily: 'Cinzel_400Regular', color: '#FFB347', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  section: { backgroundColor: '#5A1A99', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#00C853' },
  sectionTitle: { fontSize: 17, fontFamily: 'FredokaOne_400Regular', color: '#FF8C00', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, borderWidth: 1, borderColor: '#FF8C00', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  terpeneRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#7B3FBB' },
  terpeneText: { color: '#FF8C00', fontFamily: 'Cinzel_400Regular', fontSize: 14 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#7B3FBB' },
  badgeLabel: { color: '#FF8C00', fontFamily: 'Cinzel_400Regular', fontSize: 14 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 12, fontFamily: 'Cinzel_700Bold' },
  ratingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#5A1A99' },
  ratingLabel: { color: '#FF8C00', fontFamily: 'FredokaOne_400Regular', fontSize: 15 },
  ratingDesc: { color: '#FFB347', fontFamily: 'Cinzel_400Regular', fontSize: 12, marginTop: 2 },
  commentInput: { color: '#FF8C00', fontFamily: 'Cinzel_400Regular', borderWidth: 1, borderColor: '#7B3FBB', borderRadius: 8, padding: 12, minHeight: 100, textAlignVertical: 'top', fontSize: 14 },
  reviewCard: { backgroundColor: '#5A1A99', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#00C853' },
  photoBtn: { borderWidth: 1, borderColor: '#7B3FBB', borderRadius: 8, borderStyle: 'dashed', padding: 12, alignItems: 'center', marginVertical: 8 },
  photoBtnText: { color: '#7B3FBB', fontFamily: 'FredokaOne_400Regular', fontSize: 14 },
  photoThumb: { width: '100%', height: 160, borderRadius: 8 },
  // Home
  homeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#00C853' },
  welcomeText: { fontSize: 22, fontFamily: 'FredokaOne_400Regular', color: '#FF8C00' },
  scanButton: { backgroundColor: '#5A1A99', margin: 16, borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 2, borderColor: '#00C853' },
  scanButtonText: { fontSize: 22, fontFamily: 'FredokaOne_400Regular', color: '#00C853', letterSpacing: 1 },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#5A1A99', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#7B3FBB' },
  historyStrain: { fontSize: 16, fontFamily: 'FredokaOne_400Regular', color: '#FF8C00' },
  // Auth
  authInput: { backgroundColor: '#5A1A99', borderWidth: 1, borderColor: '#7B3FBB', borderRadius: 10, padding: 14, color: '#FF8C00', fontSize: 15, marginBottom: 12 },
  // Bottom tab bar
  bottomTabBar: { flexDirection: 'row', backgroundColor: '#2A0050', borderTopWidth: 1, borderTopColor: '#00C853', paddingTop: 8 },
  bottomTabItem: { flex: 1, alignItems: 'center', gap: 2 },
  bottomTabLabel: { fontFamily: 'FredokaOne_400Regular', fontSize: 11, color: '#5A1A99' },
  bottomTabLabelActive: { color: '#FF8C00' },
});
