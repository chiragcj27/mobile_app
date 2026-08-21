import { useState, useCallback } from 'react';

// Alert state for BrandedAlert. Argument order matches the call sites already in the app:
// showAlert(title, message, type, buttons). Spread the returned config straight onto the
// component: <BrandedAlert {...alertConfig} onClose={hideAlert} />
export const useBrandedAlert = () => {
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    message: '',
    type: 'info',
    buttons: [],
  });

  const showAlert = useCallback(
    (title, message, type = 'info', buttons = []) =>
      setAlertConfig({ visible: true, title, message, type, buttons }),
    [],
  );

  const hideAlert = useCallback(
    () => setAlertConfig(prev => ({ ...prev, visible: false })),
    [],
  );

  return { alertConfig, showAlert, hideAlert };
};

export default useBrandedAlert;
