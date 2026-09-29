import { useEffect, useState } from 'react';

export function useMobileLayout() {
  const [mobile, setMobile] = useState(
    () => !!window.codexDesk?.remote && window.matchMedia('(max-width: 959px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 959px)');
    const update = () => setMobile(!!window.codexDesk?.remote && query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}
