/* A strip along the bottom saying which database this build is talking to.

   It exists because the two variants are otherwise indistinguishable once
   installed — same screens, same data shapes, same Hebrew. Someone testing a
   status change needs to know at a glance whether a real garage's ticket just
   moved. The app name carries "(Staging)", but that is only visible on the home
   screen, not while you are in the app changing things.

   Deliberately absolute and pointerEvents="none": it overlays rather than
   participating in layout, so it cannot push the Stack header into the notch or
   shift a screen the rest of the app was built against.

   Silent in production — a badge that is always there stops being read. */

import { Text, View } from 'react-native';
import { appVariant, isEnvMismatch, isProductionDb } from '../lib/env';
import { projectRef } from '../lib/supabase';

export default function EnvBadge() {
  // The one case worth shouting about: the build's label and the database it
  // reached disagree, so neither can be trusted without looking.
  if (isEnvMismatch) {
    return (
      <Strip color="#a5544b">
        {`⚠ אי-התאמה: בילד ${appVariant === 'production' ? 'פרודקשן' : 'סטיג׳ינג'} מחובר ל־${projectRef || '—'}`}
      </Strip>
    );
  }

  if (isProductionDb) return null;

  return <Strip color="#8a6d1f">{`STAGING · ${projectRef || 'לא מוגדר'}`}</Strip>;
}

function Strip({ color, children }: { color: string; children: string }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: color,
        paddingVertical: 3,
        alignItems: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>
        {children}
      </Text>
    </View>
  );
}
