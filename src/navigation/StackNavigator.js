import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';

// Import screens
import LoginScreen from '../screens/Auth/LoginScreen';
import OnboardingScreen from '../screens/Onboarding/OnboardingScreen';
import BottomTabs from './BottomTabs';
import EnquiryListScreen from '../screens/Enquiries/EnquiryListScreen';
import SingleEnquiryScreen from '../screens/Enquiries/SingleEnquiryScreen';
import AddEnquiryStep1Screen from '../screens/AddEnquiry/AddEnquiryStep1Screen';
import AddEnquiryStep2Screen from '../screens/AddEnquiry/AddEnquiryStep2Screen';
import EditEnquiryStep1Screen from '../screens/EditEnquiry/EditEnquiryStep1Screen';
import EditEnquiryStep2Screen from '../screens/EditEnquiry/EditEnquiryStep2Screen';
import ChatDetailScreen from '../screens/Chats/ChatDetailScreen';
import ChatGroupsScreen from '../screens/Chats/ChatGroupsScreen';
import MetalPricesScreen from '../screens/Admin/MetalPricesScreen';
import ClientsListScreen from '../screens/Admin/ClientsListScreen';
import CreateClientScreen from '../screens/Admin/CreateClientScreen';
import ClientPricingScreen from '../screens/Admin/ClientPricingScreen';
import UsersListScreen from '../screens/Admin/UsersListScreen';
import CreateUserScreen from '../screens/Admin/CreateUserScreen';
import NotificationsScreen from '../screens/Notifications/NotificationsScreen';
import DesignViewerScreen from '../screens/DesignViewer/DesignViewerScreen';
import PricingScreen from '../screens/Pricing/PricingScreen';
import UploadDesignScreen from '../screens/UploadDesign/UploadDesignScreen';
import UploadExcelScreen from '../screens/UploadDesign/uploadExcel';
import PdfViewerTestScreen from '../screens/Test/PdfViewerTestScreen';
import PricingCalci from '../screens/Pricing/PricingCalci';
import ClientHandlerDashboardScreen from '../screens/ClientHandler/ClientHandlerDashboardScreen';
import Reports from '../screens/Reports/reports'
import JwelleryEstimate from '../screens/Pricing/JwelleryEstimate';
// TEST SCREENS - Commented out for production
// Uncomment these lines if you need to test notifications in the future
// import FontTest from '../components/FontTest';
// import NotificationTestScreen from '../screens/Test/NotificationTestScreen';
// import GetFCMTokenScreen from '../screens/Test/GetFCMTokenScreen';
// import ResponsiveDemoScreen from '../components/ResponsiveDemoScreen';

const Stack = createStackNavigator();

const StackNavigator = ({ isAuthenticated, showOnboarding, onOnboardingComplete }) => {
  
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.primary,
        },
        headerTintColor: colors.textWhite,
        headerTitleStyle: {
          fontFamily: fonts.bold,
          fontSize: fonts.lg,
        },
        // iOS default is "default" (chevron + previous screen title). "minimal" = icon only.
        headerBackButtonDisplayMode: 'minimal',
      }}>
      {isAuthenticated ? (
        // Authenticated screens
        <>
          <Stack.Screen
            name="MainTabs"
            component={BottomTabs}
            options={{
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="ClientEnquiries"
            component={EnquiryListScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ClientHandlerEnquiries"
            component={EnquiryListScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="AllClientsDashboard"
            component={ClientHandlerDashboardScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="SingleEnquiry"
            component={SingleEnquiryScreen}
            options={{
              title: 'Enquiry Details',
            }}
          />
          <Stack.Screen
            name="AddEnquiryStep1"
            component={AddEnquiryStep1Screen}
            options={({ route }) => ({
              title: route.params?.enquiry ? 'Edit Enquiry - Step 1' : 'Add Enquiry - Step 1',
            })}
          />
          <Stack.Screen
            name="AddEnquiryStep2"
            component={AddEnquiryStep2Screen}
            options={{
              title: 'Add Enquiry - Step 2',
              headerLeft: () => null, // Remove back button
            }}
          />
          <Stack.Screen
            name="EditEnquiryStep1"
            component={EditEnquiryStep1Screen}
            options={{
              title: 'Edit Enquiry - Step 1',
            }}
          />
          <Stack.Screen
            name="EditEnquiryStep2"
            component={EditEnquiryStep2Screen}
            options={{
              title: 'Edit Enquiry - Step 2',
            }}
          />
          <Stack.Screen
            name="ChatGroups"
            component={ChatGroupsScreen}
            options={{
              title: 'Chat Groups',
            }}
          />
          <Stack.Screen
            name="ChatDetail"
            component={ChatDetailScreen}
            options={{
              title: 'Chat',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="MetalPrices"
            component={MetalPricesScreen}
            options={{
              title: 'Metal Prices',
            }}
          />
          <Stack.Screen
            name="ClientsList"
            component={ClientsListScreen}
            options={{
              title: 'Clients',
            }}
          />
          <Stack.Screen
            name="CreateClient"
            component={CreateClientScreen}
            options={{
              title: 'Create Client',
            }}
          />
          <Stack.Screen
            name="ClientPricing"
            component={ClientPricingScreen}
            options={({ route }) => ({
              title: `Pricing - ${route.params?.clientName || 'Client'}`,
            })}
          />
          <Stack.Screen
            name="UsersList"
            component={UsersListScreen}
            options={{
              title: 'Users',
            }}
          />
          <Stack.Screen
            name="CreateUser"
            component={CreateUserScreen}
            options={({ route }) => ({
              title: route.params?.userId ? 'Edit User' : 'Create User',
            })}
          />
          <Stack.Screen
            name="DesignViewer"
            component={DesignViewerScreen}
            options={({ route }) => ({
              title: route.params?.designType === 'coral' 
                ? (route.params?.versionIndex !== undefined 
                    ? `Coral Design - Version ${route.params.versionIndex + 1}`
                    : 'Coral Design')
                : (route.params?.versionIndex !== undefined
                    ? `CAD Design - Version ${route.params.versionIndex + 1}`
                    : 'CAD Design'),
            })}
          />
          <Stack.Screen
            name="Pricing"
            component={PricingScreen}
            options={({ route }) => ({
              title: route.params?.designType === 'coral' ? 'Coral Pricing' : 'CAD Pricing',
            })}
          />
          <Stack.Screen
          name="PricingCalci"
          component={PricingCalci}/>

          <Stack.Screen
          name="EstimateJwellery"
          component={JwelleryEstimate}
           options={({ route }) => ({
              title: "Approx Pricing Calculator",
            })}/>

          <Stack.Screen
            name="Reports"
            component={Reports}/>

          <Stack.Screen
            name="UploadDesign"
            component={UploadDesignScreen}
            options={({ route }) => ({
              title: `Add ${route.params?.designType === 'coral' ? 'Coral' : 'CAD'}`,
            })}
          />
      <Stack.Screen
        name="PdfViewerTest"
        component={PdfViewerTestScreen}
        options={{
          title: 'PDF Viewer Test',
        }}
      />
          {/*New screen Upload excel*/}
          <Stack.Screen
            name="UploadExcel"
            component={UploadExcelScreen}
          />
          <Stack.Screen
            name="Notifications"
            component={NotificationsScreen}
            options={{
              headerShown: false,
            }}
          />
          {/* TEST SCREENS - Commented out for production
              To re-enable: Uncomment the imports at the top and uncomment these screens below
          
          <Stack.Screen
            name="FontTest"
            component={FontTest}
            options={{
              title: 'Font Test',
            }}
          />
          <Stack.Screen
            name="NotificationTest"
            component={NotificationTestScreen}
            options={{
              title: 'Notification Test',
            }}
          />
          <Stack.Screen
            name="GetFCMToken"
            component={GetFCMTokenScreen}
            options={{
              title: 'Get FCM Token',
            }}
          />
          <Stack.Screen
            name="ResponsiveDemo"
            component={ResponsiveDemoScreen}
            options={{
              title: 'Responsive Demo',
            }}
          />
          */}
        </>
      ) : (
        // Unauthenticated screens
        <>
          {showOnboarding ? (
            <Stack.Screen
              name="Onboarding"
              options={{
                headerShown: false,
              }}>
              {(props) => (
                <OnboardingScreen
                  {...props}
                  onComplete={onOnboardingComplete}
                />
              )}
            </Stack.Screen>
          ) : null}
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{
              headerShown: false,
            }}
          />
        </>
      )}
    </Stack.Navigator>
  );
};

export default StackNavigator;
