import { useEffect, useState } from 'react';
import { api } from './api.js';

/** `prepare` runs once per response; pass a function that never changes. */
export function useFetch(url, prepare = (data) => data) {
  const [state, setState] = useState({ url: null, data: null, error: null });
  useEffect(() => {
    let live = true;
    api.get(url).then(
      (data) => live && setState({ url, data: prepare(data), error: null }),
      (error) => live && setState({ url, data: null, error }),
    );
    return () => { live = false; };
  }, [url]);
  const loading = state.url !== url;
  return loading ? { data: null, error: null, loading } : { ...state, loading };
}
