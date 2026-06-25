import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';
import Icon from '../components/common/Icon';
import CustomTabBar from '../components/common/CustomTabBar';

// Import screens
import DashboardScreen from '../screens/Dashboard/DashboardScreen';
import EnquiryListScreen from '../screens/Enquiries/EnquiryListScreen';
import ChatsScreen from '../screens/Chats/ChatsScreen';
import AppsSelectionScreen from '../screens/AppSelection/AppSelectionScreen';
import ClientHandlerDashboardScreen from '../screens/ClientHandler/ClientHandlerDashboardScreen';
import {useAuth} from '../context/AuthContext';

const Tab = createBottomTabNavigator();

const BottomTabs = () => {
  const {user} = useAuth();

  const renderTabs = ()=>{
    if(user?.role==='admin'){
      return(
         <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} currentApp="custom" />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Icon name="dashboard" size={size || 24} color={color} />,
        }}
      />
      <Tab.Screen
        name="Enquiries"
        component={EnquiryListScreen}
        options={{
          title: 'Enquiries',
          tabBarIcon: ({ color, size }) => <Icon name="assignment" size={size || 24} color={color} />,
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => <Icon name="chat" size={size || 24} color={color} />,
        }}
      />
 
    </Tab.Navigator>
      )

      
    }

  else if(user?.role==='coral'){
    return(
       <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} currentApp="custom" />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tab.Screen
        name="Enquiries"
        component={EnquiryListScreen}
        options={{
          title: 'Enquiries',
          tabBarIcon: ({ color, size }) => <Icon name="assignment" size={size || 24} color={color} />,
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => <Icon name="chat" size={size || 24} color={color} />,
        }}
      />

    </Tab.Navigator>
    )
  }

  else if(user?.role==='cad'){
    return(
       <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} currentApp="custom" />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tab.Screen
        name="Enquiries"
        component={EnquiryListScreen}
        options={{
          title: 'Enquiries',
          tabBarIcon: ({ color, size }) => <Icon name="assignment" size={size || 24} color={color} />,
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => <Icon name="chat" size={size || 24} color={color} />,
        }}
      />

    </Tab.Navigator>
    )
  }

  else if (user?.role === 'client_handler') {
    return (
      <Tab.Navigator
        tabBar={(props) => <CustomTabBar {...props} currentApp="custom" />}
        screenOptions={{ headerShown: false }}>
        <Tab.Screen
          name="Dashboard"
          component={ClientHandlerDashboardScreen}
          options={{
            title: 'My Clients',
            tabBarIcon: ({ color, size }) => <Icon name="account" size={size || 24} color={color} />,
          }}
        />
        <Tab.Screen
          name="Enquiries"
          component={EnquiryListScreen}
          options={{
            title: 'Enquiries',
            tabBarIcon: ({ color, size }) => <Icon name="assignment" size={size || 24} color={color} />,
          }}
        />
        <Tab.Screen
          name="Chats"
          component={ChatsScreen}
          options={{
            title: 'Chats',
            tabBarIcon: ({ color, size }) => <Icon name="chat" size={size || 24} color={color} />,
          }}
        />
      </Tab.Navigator>
    );
  }

  else{
    return(
         <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} currentApp="custom" />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Icon name="dashboard" size={size || 24} color={color} />,
        }}
      />
      <Tab.Screen
        name="Enquiries"
        component={EnquiryListScreen}
        options={{
          title: 'Enquiries',
          tabBarIcon: ({ color, size }) => <Icon name="assignment" size={size || 24} color={color} />,
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => <Icon name="chat" size={size || 24} color={color} />,
        }}
      />
 
    </Tab.Navigator>
    )
  }
  }
  return (
   <>
   {renderTabs()}
   </>
  );
};

export default BottomTabs;
