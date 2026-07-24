import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { clearCart } from '../services/cartStorage';

const OrderingAsClientContext = createContext({
  orderingClient: null,
  startOrderingFor: () => {},
  cancelOrderingFor: async () => {},
  clearOrderingClient: () => {},
});

export function OrderingAsClientProvider({ children }) {
  const [orderingClient, setOrderingClient] = useState(null);

  const startOrderingFor = useCallback((client) => {
    setOrderingClient(client);
  }, []);

  const clearOrderingClient = useCallback(() => {
    setOrderingClient(null);
  }, []);

  const cancelOrderingFor = useCallback(async () => {
    setOrderingClient(null);
    await clearCart();
  }, []);

  const value = useMemo(
    () => ({ orderingClient, startOrderingFor, cancelOrderingFor, clearOrderingClient }),
    [orderingClient, startOrderingFor, cancelOrderingFor, clearOrderingClient],
  );

  return (
    <OrderingAsClientContext.Provider value={value}>{children}</OrderingAsClientContext.Provider>
  );
}

export function useOrderingAsClient() {
  return useContext(OrderingAsClientContext);
}
