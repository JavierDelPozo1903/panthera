import { useEffect, useState } from 'react';

/**
 * Re-renderiza el componente a una frecuencia fija leyendo estado mutable (reloj, jugador).
 * Evita pasar datos de 60 Hz por React.
 */
export function useTicker<T>(read: () => T, hz = 10): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setValue(read()), 1000 / hz);
    return () => window.clearInterval(id);
    // `read` se considera estable durante la vida del componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hz]);
  return value;
}
