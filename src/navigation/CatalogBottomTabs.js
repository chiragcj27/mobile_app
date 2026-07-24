import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import CustomTabBar from '../components/common/CustomTabBar';
import { CartProvider } from '../context/CartContext';
import { OrderingAsClientProvider } from '../context/OrderingAsClientContext';
import OrderingAsClientBanner from '../components/client/OrderingAsClientBanner';
import { useAuth } from '../context/AuthContext';
import HomeScreen from '../screens/ClientApp/HomeScreen';
import FeaturedCollectionScreen from '../screens/ClientApp/FeaturedCollectionScreen';
import CategoryDetailsScreen from '../screens/ClientApp/CategoryDetailsScreen';
import ProductListScreen from '../screens/ClientApp/ProductListScreen';
import ProductMatrixScreen from '../screens/ClientApp/ProductMatrixScreen';
import RingMatrixPage from '../screens/ClientApp/RingMatrixPage';
import JacketsScreen from '../screens/ClientApp/JacketsScreen';
import OrderReviewScreen from '../screens/ClientApp/OrderReviewScreen';
import BulkOrderParserScreen from '../screens/ClientApp/BulkOrderParserScreen';
import OrderCartScreen from '../screens/ClientApp/OrderCartScreen';
import OrderPlacedScreen from '../screens/ClientApp/OrderPlacedScreen';
import MyOrdersScreen from '../screens/ClientApp/MyOrdersScreen';
import MyOrderDetailsScreen from '../screens/ClientApp/MyOrderDetailsScreen';
import MyShipmentTrackingScreen from '../screens/ClientApp/MyShipmentTrackingScreen';
import OrderInvoicesScreen from '../screens/ClientApp/OrderInvoicesScreen';
import AdminOrdersListScreen from '../screens/ClientApp/AdminOrdersListScreen';
import AdminClientOrdersScreen from '../screens/ClientApp/AdminClientOrdersScreen';
import AdminOrderDetailsScreen from '../screens/ClientApp/AdminOrderDetailsScreen';
import AdminSelectClientScreen from '../screens/ClientApp/AdminSelectClientScreen';
import SearchScreen from '../screens/ClientApp/SearchScreen';
import ProductImageViewerScreen from '../screens/ClientApp/ProductImageViewerScreen';

const isAdminUser = (user) => {
  if (!user) return false;
  const role = user.role;
  if (typeof role === 'string' && role.toLowerCase() === 'admin') return true;
  const roleNum = user.roleId ?? user.roleNumber;
  return roleNum === 1 || roleNum === '1';
};
const Tab = createBottomTabNavigator();
const DashboardStack = createStackNavigator();
const CartStack = createStackNavigator();
const OrdersStack = createStackNavigator();

const DashboardStackScreen = () => (
  <DashboardStack.Navigator
    screenOptions={{
      headerShown: false,
    }}>
    <DashboardStack.Screen name="HomeScreen" component={HomeScreen} />
    <DashboardStack.Screen name="Search" component={SearchScreen} />
    <DashboardStack.Screen name="FeaturedCollection" component={FeaturedCollectionScreen} />
    <DashboardStack.Screen name="CategoryDetails" component={CategoryDetailsScreen} />
    <DashboardStack.Screen name="ProductList" component={ProductListScreen} />
    <DashboardStack.Screen name="ProductMatrix" component={ProductMatrixScreen} />
    <DashboardStack.Screen name="RingMatrixPage" component={RingMatrixPage} />
    <DashboardStack.Screen name="JacketsScreen" component={JacketsScreen} />
    <DashboardStack.Screen name="ProductImageViewer" component={ProductImageViewerScreen} />
    <DashboardStack.Screen name="BulkOrderParser" component={BulkOrderParserScreen} />
    <DashboardStack.Screen name="OrderReview" component={OrderReviewScreen} />
  </DashboardStack.Navigator>
);

const CartStackScreen = () => (
  <CartStack.Navigator
    screenOptions={{
      headerShown: false,
    }}>
    <CartStack.Screen name="OrderCart" component={OrderCartScreen} />
    <CartStack.Screen name="OrderPlaced" component={OrderPlacedScreen} />
  </CartStack.Navigator>
);

const OrdersStackScreen = () => {
  const { user } = useAuth();
  const isAdmin = useMemo(() => isAdminUser(user), [user]);

  return (
    <OrdersStack.Navigator
      initialRouteName={isAdmin ? 'AdminOrdersList' : 'MyOrdersList'}
      screenOptions={{ headerShown: false }}>
      {/* Admin order screens */}
      <OrdersStack.Screen name="AdminOrdersList" component={AdminOrdersListScreen} />
      <OrdersStack.Screen name="AdminClientOrders" component={AdminClientOrdersScreen} />
      <OrdersStack.Screen name="AdminOrderDetails" component={AdminOrderDetailsScreen} />
      <OrdersStack.Screen name="AdminSelectClient" component={AdminSelectClientScreen} />
      {/* Client order screens */}
      <OrdersStack.Screen name="MyOrdersList" component={MyOrdersScreen} />
      <OrdersStack.Screen name="MyOrderDetails" component={MyOrderDetailsScreen} />
      <OrdersStack.Screen name="MyShipmentTracking" component={MyShipmentTrackingScreen} />
      <OrdersStack.Screen name="OrderInvoices" component={OrderInvoicesScreen} />
    </OrdersStack.Navigator>
  );
};

const CatalogBottomTabs = () => {
  return (
    <CartProvider>
      <OrderingAsClientProvider>
        <View style={styles.tabsWrap}>
          <OrderingAsClientBanner />
          <Tab.Navigator
            tabBar={(props) => <CustomTabBar {...props} currentApp="catalog" />}
            screenOptions={{
              headerShown: false,
            }}
          >
            <Tab.Screen
              name="Dashboard"
              component={DashboardStackScreen}
              options={{ title: 'Dashboard' }}
            />
            <Tab.Screen
              name="Cart"
              component={CartStackScreen}
              options={{ title: 'Cart' }}
            />
            <Tab.Screen
              name="MyOrders"
              component={OrdersStackScreen}
              options={{ title: 'My Orders' }}
            />
          </Tab.Navigator>
        </View>
      </OrderingAsClientProvider>
    </CartProvider>
  );
};

const styles = StyleSheet.create({
  tabsWrap: {
    flex: 1,
  },
});

export default CatalogBottomTabs;
