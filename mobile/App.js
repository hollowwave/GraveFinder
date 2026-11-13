import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Home from './src/screens/Home';
import Search from './src/screens/Search';
import Record from './src/screens/Record';
import CemeteryMap from './src/screens/CemeteryMap';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.paper },
            headerTintColor: colors.moss,
            headerTitleStyle: { color: colors.ink },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.paper },
          }}
        >
          <Stack.Screen name="Home" component={Home} options={{ headerShown: false }} />
          <Stack.Screen name="Search" component={Search} options={{ title: 'Find a burial' }} />
          <Stack.Screen name="Record" component={Record} options={{ title: 'Burial record' }} />
          <Stack.Screen name="Map" component={CemeteryMap} options={{ title: 'Cemetery map' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
