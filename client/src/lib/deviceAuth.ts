const DEVICE_ID_KEY = 'audio_transcript_device_id';

/**
 * Get or generate a persistent device ID from localStorage
 */
export function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  
  if (!deviceId) {
    // Generate new UUID for this device using built-in crypto
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    console.log('[DeviceAuth] Generated new device ID');
  }
  
  return deviceId;
}

/**
 * Authenticate device with the backend
 */
export async function authenticateDevice() {
  const deviceId = getDeviceId();
  
  try {
    const response = await fetch('/api/auth/device', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId }),
    });
    
    if (!response.ok) {
      throw new Error(`Device auth failed: ${response.statusText}`);
    }
    
    const user = await response.json();
    console.log('[DeviceAuth] Authentication successful:', user);
    return user;
  } catch (error) {
    console.error('[DeviceAuth] Authentication failed:', error);
    throw error;
  }
}
