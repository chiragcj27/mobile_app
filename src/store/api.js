import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { Platform } from 'react-native';
import secureStorage from '../utils/secureStorage';
import {
  decodeJWT,
  mapRoleNumberToString,
  setRolesCache,
} from '../utils/helpers';
import { API_BASE_URL } from '../config/apiConfig';

// Base query with auth token injection
const baseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  prepareHeaders: async (headers, { getState }) => {
    try {
      const token = await secureStorage.getItem('token');
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
        if (__DEV__) {
          console.log(
            'API Request Headers - Authorization token set:',
            token.substring(0, 20) + '...',
          );
        }
      } else {
      }
      // Ensure Content-Type is set for JSON requests (RTK Query does this automatically, but being explicit)
      if (!headers.get('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      // Set Accept header to match web behavior
      headers.set('Accept', 'application/json');
    } catch (error) {}
    return headers;
  },
});

// Export the main API
export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: [
    'Enquiry',
    'Client',
    'Dashboard',
    'MetalPrice',
    'Chat',
    'Message',
    'StatusStatistics',
    'Roles',
    'Statuses',
    'StoneTypes',
    'Notification',
    'DeviceToken',
    'Users',
  ],
  // Prevent memory buildup by removing unused data after 60 seconds
  keepUnusedDataFor: 60,
  endpoints: builder => ({
    getRoles: builder.query({
      query: () => '/api/codelists/Roles',
      providesTags: ['Roles'],
      transformResponse: data => {
        let roles = [];

        // Handle array response
        if (Array.isArray(data)) {
          roles = data.map(role => ({
            id: role.Id || role.id,
            code: role.Code || role.code,
            name: role.Name || role.name,
          }));
        }
        // Handle object response with data property
        else if (data?.data && Array.isArray(data.data)) {
          roles = data.data.map(role => ({
            id: role.Id || role.id,
            code: role.Code || role.code,
            name: role.Name || role.name,
          }));
        }

        // Update cache for role mapping
        if (roles.length > 0) {
          setRolesCache(roles);
        } else {
        }

        return roles;
      },
    }),

    // Get Status list from API
    getStatuses: builder.query({
      query: () => '/api/codelists/Status',
      providesTags: ['Statuses'],
      transformResponse: data => {
        let statuses = [];
        console.log('ðŸ” Data:', data);
        // Handle array response
        if (Array.isArray(data)) {
          statuses = data.map(status => ({
            id: status.Id || status.id,
            name: status.name || status.Name || status.code || status.Code,
            label:
              status.label ||
              status.Label ||
              status.name ||
              status.Name ||
              status.code ||
              status.Code,
          }));
        }
        // Handle object response with data property
        else if (data?.data && Array.isArray(data.data)) {
          statuses = data.data.map(status => ({
            id: status.Id || status.id,
            name: status.name || status.Name || status.code || status.Code,
            label:
              status.label ||
              status.Label ||
              status.name ||
              status.Name ||
              status.code ||
              status.Code,
          }));
        }

        return statuses;
      },
    }),

    // Get Stone Types list from API
    getStoneTypes: builder.query({
      query: () => '/api/codelists/StoneTypes',
      providesTags: ['StoneTypes'],
      transformResponse: data => {
        let stoneTypes = [];

        // Handle array response
        if (Array.isArray(data)) {
          stoneTypes = data.map(stoneType => ({
            label:
              stoneType.label ||
              stoneType.Label ||
              stoneType.name ||
              stoneType.Name ||
              stoneType.code ||
              stoneType.Code ||
              stoneType.value ||
              stoneType.Value,
            value:
              stoneType.value ||
              stoneType.Value ||
              stoneType.code ||
              stoneType.Code ||
              stoneType.name ||
              stoneType.Name,
          }));
        }
        // Handle object response with data property
        else if (data?.data && Array.isArray(data.data)) {
          stoneTypes = data.data.map(stoneType => ({
            label:
              stoneType.label ||
              stoneType.Label ||
              stoneType.name ||
              stoneType.Name ||
              stoneType.code ||
              stoneType.Code ||
              stoneType.value ||
              stoneType.Value,
            value:
              stoneType.value ||
              stoneType.Value ||
              stoneType.code ||
              stoneType.Code ||
              stoneType.name ||
              stoneType.Name,
          }));
        }

        return stoneTypes;
      },
    }),

    login: builder.mutation({
      query: ({ email, password }) => {
        return {
          url: '/api/login',
          method: 'POST',
          body: { email, password },
        };
      },
      transformResponse: async (response, meta, arg) => {
        try {
          // Handle different response formats
          let data = response;
          if (typeof response === 'string') {
            try {
              data = JSON.parse(response);
            } catch (e) {
              data = response; // It's just the token string
            }
          }

          const token =
            typeof data === 'string'
              ? data
              : data.token || data.accessToken || data.access_token;

          if (!token) {
            throw new Error('No token received from server');
          }

          if (__DEV__) {
            console.log('Token preview:', token.substring(0, 50) + '...');
          }

          const decodedToken = decodeJWT(token);
          if (!decodedToken) {
            throw new Error('Failed to decode authentication token');
          }

          // Try different case variations for role
          const roleNumber =
            decodedToken.Role ||
            decodedToken.role ||
            decodedToken.RoleNumber ||
            decodedToken.roleNumber;

          if (roleNumber === undefined || roleNumber === null) {
            throw new Error(
              `Role not found in token. Available fields: ${Object.keys(
                decodedToken,
              ).join(', ')}`,
            );
          }

          const roleString = mapRoleNumberToString(roleNumber);

          if (!roleString) {
            throw new Error(`Unknown role: ${roleNumber}. Expected 1-5.`);
          }

          // Try different case variations for ID
          const userId =
            decodedToken.Id ||
            decodedToken.id ||
            decodedToken.userId ||
            decodedToken.UserId;

          // Try different case variations for name
          const userName =
            decodedToken.Name ||
            decodedToken.name ||
            decodedToken.username ||
            decodedToken.Username ||
            decodedToken.fullName ||
            decodedToken.FullName ||
            decodedToken.firstName ||
            decodedToken.FirstName;

          // Extract ClientId from token (for role 4 - Client users)
          const clientId =
            decodedToken.ClientId ||
            decodedToken.clientId ||
            decodedToken.ClientID ||
            decodedToken.clientID;

          return {
            success: true,
            token,
            user: {
              id: userId,
              role: roleString,
              roleNumber: roleNumber, // Store role ID for filtering
              roleId: roleNumber, // Alias for consistency
              name: userName, // Extract name from token
              clientId: clientId, // Store ClientId for role 4 users
              iat: decodedToken.iat,
            },
          };
        } catch (error) {
          throw new Error(error.message || 'Login failed');
        }
      },
      transformErrorResponse: response => {
        // Provide helpful error messages for common network issues
        let errorMessage = 'Login failed';
        if (
          response.status === 'FETCH_ERROR' ||
          response.error?.includes('Network request failed')
        ) {
          errorMessage = `Cannot connect to server at ${API_BASE_URL}. Please check:\n\n1. Backend server is running\n2. Server is on port 3000\n3. For Android emulator, use 10.0.2.2:3000\n4. For physical device, use your computer's IP address`;
        } else {
          errorMessage =
            response.data?.message ||
            response.data?.error ||
            response.error ||
            `Login failed (${response.status || 'Unknown error'})`;
        }

        return {
          success: false,
          error: errorMessage,
        };
      },
    }),

    // Create user/register endpoint
    createUser: builder.mutation({
      query: data => ({
        url: '/api/users',
        method: 'POST',
        body: data,
      }),
      transformResponse: response => {
        console.log(
          'ðŸ†• [createUser] Raw API Response:',
          JSON.stringify(response, null, 2),
        );
        return {
          success: true,
          user: response.user || response,
          message: response.message || 'User created successfully',
        };
      },
      transformErrorResponse: response => {
        return {
          success: false,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to create user',
        };
      },
    }),

    // Get user by ID endpoint
    getUserById: builder.query({
      query: userId => `/api/users/${userId}`,
      transformResponse: response => {
        console.log(
          'ðŸ‘¤ [getUserById] Raw API Response:',
          JSON.stringify(response, null, 2),
        );
        // Handle different response formats
        const user = response.user || response;
        return {
          id: user._id || user.id || user.Id,
          name: user.name || user.Name,
          email: user.email || user.Email,
          phone: user.phone || user.Phone,
          role: user.role || user.Role,
          clientId: user.clientId || user.ClientId,
          skills: user.skills || user.Skills,
          ...user,
        };
      },
      transformErrorResponse: response => {
        return {
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to fetch user',
        };
      },
    }),

    // Update user endpoint
    updateUser: builder.mutation({
      query: ({ userId, ...data }) => {
        console.log(
          'ðŸ"¤ [updateUser] userId:',
          userId,
          'payload:',
          JSON.stringify(data, null, 2),
        );
        return {
          url: `/api/users/${userId}`,
          method: 'PUT',
          body: data,
        };
      },
      invalidatesTags: ['Users'],
      transformResponse: response => {
        console.log(
          'âœ… [updateUser] Response:',
          JSON.stringify(response, null, 2),
        );
        return {
          success: true,
          user: response.user || response,
          message: response.message || 'User updated successfully',
        };
      },
      transformErrorResponse: response => {
        console.log(
          'âŒ [updateUser] Error:',
          JSON.stringify(response, null, 2),
        );
        return {
          success: false,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to update user',
        };
      },
    }),

    // Delete user endpoint
    deleteUser: builder.mutation({
      query: userId => ({
        url: `/api/users/${userId}`,
        method: 'DELETE',
      }),
      transformResponse: response => {
        return {
          success: true,
          message: response.message || 'User deleted successfully',
        };
      },
      transformErrorResponse: response => {
        return {
          success: false,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to delete user',
        };
      },
    }),

    // Get users list endpoint
    getUsers: builder.query({
      query: () => '/api/users',
      providesTags: ['Users'],
      transformResponse: data => {
        let usersArray = [];
        if (Array.isArray(data)) {
          usersArray = data;
        } else if (data.users && Array.isArray(data.users)) {
          usersArray = data.users;
        } else if (data.data && Array.isArray(data.data)) {
          usersArray = data.data;
        } else {
          return [];
        }

        return usersArray.map(user => ({
          id: user._id || user.id || user.Id,
          name: user.name || user.Name || 'Unnamed User',
          email: user.email || user.Email || 'N/A',
          phone: user.phone || user.Phone || 'N/A',
          role: user.role || user.Role || 'user',
          skills: user.skills || user.Skills || '',
          ...user,
        }));
      },
    }),

    parseEnquiry: builder.mutation({
      query: ({ message, mediaType }) => ({
        url: '/api/enquiries/parse',
        method: 'POST',
        body: {
          message,
          mediaType,
        },
      }),
      transformResponse: response => {
        if (__DEV__) {
          console.log('âœ… Parse enquiry response:', response);
        }
        return response;
      },
      transformErrorResponse: response => {
        if (__DEV__) {
          console.error('âŒ Parse enquiry error:', response);
        }
        return {
          status: response.status,
          data: response.data,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to parse enquiry',
        };
      },
    }),

    // Submit final enquiry with images and data
    submitEnquiry: builder.mutation({
      queryFn: async (
        { data, referenceImages },
        { dispatch },
        extraOptions,
        baseQuery,
      ) => {
        try {
          const token = await secureStorage.getItem('token');
          if (!token) {
            return {
              error: {
                status: 'CUSTOM_ERROR',
                data: 'Authentication token not found',
              },
            };
          }

          // Create FormData
          const formData = new FormData();

          // Add data as JSON string
          formData.append('data', JSON.stringify(data));

          // Add reference images
          if (referenceImages && referenceImages.length > 0) {
            referenceImages.forEach((image, index) => {
              const defaultType = 'image/jpeg';
              const defaultName = `image_${index}_${Date.now()}.jpg`;

              formData.append('referenceImages', {
                uri: image.uri,
                type: image.type || defaultType,
                name: image.name || defaultName,
              });
            });
          }

          const endpoint = '/api/enquiries';
          const fullUrl = `${API_BASE_URL}${endpoint}`;

          if (__DEV__) {
            console.log('ðŸ“¤ [submitEnquiry] Submitting enquiry:', {
              endpoint: fullUrl,
              dataKeys: Object.keys(data),
              imagesCount: referenceImages?.length || 0,
            });
          }

          const response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          });

          if (response.ok) {
            const result = await response.json();
            if (__DEV__) {
              console.log('âœ… [submitEnquiry] Success:', result);
            }
            return { data: result };
          } else {
            const errorText = await response.text();
            let errorData;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { message: errorText || 'Failed to submit enquiry' };
            }

            if (__DEV__) {
              console.error('âŒ [submitEnquiry] Error:', errorData);
            }

            return {
              error: {
                status: response.status,
                data: errorData,
              },
            };
          }
        } catch (error) {
          if (__DEV__) {
            console.error('âŒ [submitEnquiry] Exception:', error);
          }
          return {
            error: {
              status: 'CUSTOM_ERROR',
              data: error.message || 'Failed to submit enquiry',
            },
          };
        }
      },
      invalidatesTags: ['Enquiry', 'Dashboard', 'StatusStatistics'],
    }),

    getEnquiries: builder.query({
      providesTags: ['Enquiry'],
      query: arg => {
        // Support both object format { role, page, search, limit, assignedTo } and simple role string
        const role = typeof arg === 'object' ? arg?.role : arg;
        const page = typeof arg === 'object' ? arg?.page || 1 : 1;
        const search = typeof arg === 'object' ? arg?.search : undefined;
        const limit = typeof arg === 'object' ? arg?.limit : undefined;
        const assignedTo =
          typeof arg === 'object' ? arg?.assignedTo : undefined;
        const filters = typeof arg === 'object' ? arg?.filters : undefined;
        const idParam = typeof arg === 'object' ? arg?.id : undefined;

        // Build query string
        let queryString = `page=${page}`;
        if (idParam) {
          queryString += `&id=${encodeURIComponent(idParam)}`;
        }
        if (limit) {
          queryString += `&limit=${limit}`;
        }
        if (search && search.trim()) {
          queryString += `&search=${encodeURIComponent(search.trim())}`;
        }
        // Add assignedTo filter ONLY for non-admin users
        // CRITICAL: Never add assignedTo for admins - they must see ALL enquiries
        // Check if role is admin (case-insensitive) to ensure no assignedTo filter
        const isAdminRole =
          role?.toLowerCase() === 'admin' || role?.toLowerCase() === 'ad';
        if (assignedTo && !isAdminRole) {
          queryString += `&assignedTo=${encodeURIComponent(assignedTo)}`;
        } else if (isAdminRole && assignedTo) {
          // Safety check: if somehow assignedTo is set for admin, log warning and don't add it
          if (__DEV__) {
            console.warn(
              'âš ï¸ WARNING: assignedTo was set for admin user, ignoring it to show all enquiries',
            );
            console.warn('âš ï¸ Role:', role, 'AssignedTo:', assignedTo);
          }
        }

        // For client users, backend should filter enquiries automatically
        // If no clientId filter is provided, backend should filter by user role
        const isClientRole = role === 'client' || role === 'CL';
        const argUserId = typeof arg === 'object' ? arg?.userId : undefined;

        // For client users without a clientId, backend should filter by:
        // 1. Enquiries where clientId matches any client record
        // 2. OR enquiries created by this user (if createdBy field exists)
        // 3. OR backend should handle client filtering based on user role

        // Add filter parameters
        if (filters) {
          if (filters.status && filters.status !== 'all') {
            if (Array.isArray(filters.status) && filters.status.length > 0) {
              filters.status.forEach(status => {
                queryString += `&status=${encodeURIComponent(status)}`;
              });
            } else if (typeof filters.status === 'string') {
              queryString += `&status=${encodeURIComponent(filters.status)}`;
            }
          }
          if (filters.subStatus) {
            if (Array.isArray(filters.subStatus)) {
              filters.subStatus.forEach(s => {
                queryString += `&subStatus=${encodeURIComponent(s)}`;
              });
            } else {
              queryString += `&subStatus=${encodeURIComponent(
                filters.subStatus,
              )}`;
            }
          }
          if (filters.unassigned === true || filters.unassigned === 'true') {
            queryString += `&unassigned=true`;
          }
          if (filters.category && filters.category !== 'all') {
            queryString += `&category=${encodeURIComponent(filters.category)}`;
          }
          if (filters.priority && filters.priority !== 'all') {
            queryString += `&priority=${encodeURIComponent(filters.priority)}`;
          }
          if (filters.clientId && filters.clientId !== 'all') {
            queryString += `&clientId=${encodeURIComponent(filters.clientId)}`;
          } else if (
            isClientRole &&
            argUserId &&
            (!filters.clientId || filters.clientId === 'all')
          ) {
            // Fallback: For client users without a clientId filter, use userId as clientId
            console.log(
              'ðŸ” ========== API CLIENT FILTER (FALLBACK) ==========',
            );
            queryString += `&clientId=${encodeURIComponent(argUserId)}`;
          }
          if (filters.assignedTo && filters.assignedTo !== 'all') {
            queryString += `&assignedTo=${encodeURIComponent(
              filters.assignedTo,
            )}`;
          }
          if (filters.stoneType && filters.stoneType !== 'all') {
            queryString += `&stoneType=${encodeURIComponent(
              filters.stoneType,
            )}`;
          }
          if (filters.metalColor && filters.metalColor !== 'all') {
            queryString += `&metalColor=${encodeURIComponent(
              filters.metalColor,
            )}`;
          }
          if (filters.metalQuality && filters.metalQuality !== 'all') {
            queryString += `&metalQuality=${encodeURIComponent(
              filters.metalQuality,
            )}`;
          }
          if (filters.shippingDateFrom) {
            queryString += `&shippingDateFrom=${encodeURIComponent(
              filters.shippingDateFrom,
            )}`;
          }
          if (filters.shippingDateTo) {
            queryString += `&shippingDateTo=${encodeURIComponent(
              filters.shippingDateTo,
            )}`;
          }
          if (filters.assignedDateFrom) {
            queryString += `&assignedDateFrom=${encodeURIComponent(
              filters.assignedDateFrom,
            )}`;
          }
          if (filters.assignedDateTo) {
            queryString += `&assignedDateTo=${encodeURIComponent(
              filters.assignedDateTo,
            )}`;
          }
          if (filters.createdDateFrom) {
            queryString += `&createdDateFrom=${encodeURIComponent(
              filters.createdDateFrom,
            )}`;
          }
          if (filters.createdDateTo) {
            queryString += `&createdDateTo=${encodeURIComponent(
              filters.createdDateTo,
            )}`;
          }
          if (filters.sortBy) {
            queryString += `&sortBy=${encodeURIComponent(filters.sortBy)}`;
          }
          if (filters.sortOrder) {
            queryString += `&sortOrder=${encodeURIComponent(
              filters.sortOrder,
            )}`;
          }
        } else {
          // Even if no filters, ensure default sort is applied for consistent ordering
          queryString += `&sortBy=CreatedDate&sortOrder=desc`;
        }

        const finalUrl = `/api/enquiries/search?${queryString}`;
        return finalUrl;
      },
      transformResponse: (data, meta, arg) => {
        const role = typeof arg === 'object' ? arg?.role : arg;
        const argUserId = typeof arg === 'object' ? arg?.userId : undefined;
        const isClientRole = role === 'client' || role === 'CL';
        if (isClientRole) {
        }

        // Handle paginated response format from new aggregated endpoint
        // Response structure: { data: [...], total: number, page: number, limit: number }
        let enquiriesArray = [];
        let pagination = {
          total: 0,
          page: 1,
          limit: 25,
          totalPages: 1,
        };

        if (data && typeof data === 'object') {
          if (data.data && Array.isArray(data.data)) {
            enquiriesArray = data.data;
            pagination = {
              total: data.total || data.Total || 0,
              page: data.page || data.Page || 1,
              limit: data.limit || data.Limit || 25,
              totalPages: Math.ceil(
                (data.total || data.Total || 0) /
                  (data.limit || data.Limit || 25),
              ),
            };
            // Log for client users
            if (isClientRole && argUserId) {
              if (enquiriesArray.length > 0) {
                console.log(
                  'ðŸ“¥ Sample enquiry ClientIds:',
                  enquiriesArray.slice(0, 5).map(e => ({
                    id: e.id || e._id,
                    clientId: e.clientId || e.ClientId,
                    name: e.Name || e.name,
                  })),
                );
                // Check if any enquiries match the expected ClientId
                const matchingCount = enquiriesArray.filter(e => {
                  const enquiryClientId = e.clientId || e.ClientId || '';
                  return (
                    String(enquiryClientId).trim() === String(argUserId).trim()
                  );
                }).length;
                console.log(
                  'ðŸ“¥ Matching enquiries (ClientId = user.id):',
                  matchingCount,
                  'out of',
                  enquiriesArray.length,
                );
                if (matchingCount === 0 && enquiriesArray.length > 0) {
                  console.warn(
                    'ðŸ“¥ âš ï¸ All enquiry ClientIds:',
                    enquiriesArray
                      .map(e => e.clientId || e.ClientId)
                      .filter(Boolean)
                      .slice(0, 10),
                  );
                }
              } else {
              }
            }
          } else if (Array.isArray(data)) {
            enquiriesArray = data;
          } else if (data.enquiries && Array.isArray(data.enquiries)) {
            enquiriesArray = data.enquiries;
          } else {
            return { data: [], pagination };
          }
        } else if (Array.isArray(data)) {
          enquiriesArray = data;
        } else {
          return { data: [], pagination };
        }

        // Normalize enquiry data from aggregated endpoint
        const normalizedEnquiries = enquiriesArray.map((enquiry, index) => {
          // Derive from StatusHistory or use flat fields directly
          const history = enquiry?.StatusHistory;
          const latestEntry =
            Array.isArray(history) && history.length > 0
              ? history[history.length - 1]
              : null;
          const currentStatus =
            latestEntry?.Status || enquiry?.CurrentStatus || 'pending';
          const currentSubStatus =
            latestEntry?.SubStatus || enquiry?.CurrentSubStatus || null;
          const createdAt =
            enquiry.CreatedDate ||
            enquiry.CreatedAt ||
            new Date().toISOString();
          const updatedAt =
            enquiry.AssignedDate || enquiry.UpdatedAt || createdAt;

          // Normalize priority
          let normalizedPriority = 'medium';
          const priority = (
            enquiry.Priority ||
            enquiry.priority ||
            ''
          ).toLowerCase();
          if (
            priority.includes('urgent') ||
            priority === 'high' ||
            priority === 'super high'
          ) {
            normalizedPriority = 'high';
          } else if (priority === 'low') {
            normalizedPriority = 'low';
          } else {
            normalizedPriority = 'medium';
          }

          // Normalize status from CurrentStatus field
          let normalizedStatus = 'pending';
          const status = currentStatus.toLowerCase();
          if (status === 'enquiry created' || status === 'pending') {
            normalizedStatus = 'pending';
          } else if (
            status.includes('design approval') ||
            (status.includes('approval') && status.includes('pending'))
          ) {
            normalizedStatus = 'approval_pending';
          } else if (status.includes('approved') && status.includes('cad')) {
            normalizedStatus = 'approved_cad';
          } else if (status.includes('quotation')) {
            normalizedStatus = 'quotation';
          } else if (status === 'coral') {
            normalizedStatus = 'coral';
          } else if (status === 'cad') {
            normalizedStatus = 'cad';
          } else if (status.includes('order')) {
            normalizedStatus = 'order_placement';
          } else if (status.includes('production')) {
            normalizedStatus = 'production';
          } else if (status.includes('shipped')) {
            normalizedStatus = 'shipped';
          } else if (
            status.includes('completed') ||
            status.includes('approved')
          ) {
            normalizedStatus = 'completed';
          } else if (status.includes('rejected')) {
            normalizedStatus = 'rejected';
          } else if (status.includes('pending')) {
            normalizedStatus = 'pending';
          } else {
            normalizedStatus = 'in_progress';
          }

          // Extract metal type info
          const metalColor = enquiry.Metal?.Color || enquiry.metal?.color || '';
          const metalQuality =
            enquiry.Metal?.Quality || enquiry.metal?.quality || '';
          const metalType = metalColor
            ? `${metalColor}${metalQuality ? ` (${metalQuality})` : ''}`
            : 'N/A';

          // Get budget from Coral pricing (if available in aggregated response)
          let budget = 0;
          if (
            enquiry.Coral &&
            Array.isArray(enquiry.Coral) &&
            enquiry.Coral.length > 0
          ) {
            const latestCoral = enquiry.Coral[enquiry.Coral.length - 1];
            if (latestCoral.Pricing?.TotalPrice) {
              budget = latestCoral.Pricing.TotalPrice;
            }
          }

          // Extract client name if available (may need to be enriched from clients API)
          const clientName =
            enquiry.ClientName || enquiry.clientName || 'Unknown Client';

          const normalized = {
            id: enquiry._id || enquiry.id,
            title:
              enquiry.Name ||
              enquiry.name ||
              enquiry.title ||
              'Untitled Enquiry',
            clientId: enquiry.ClientId || enquiry.clientId || '',
            clientName: clientName,
            status: normalizedStatus,
            priority: normalizedPriority,
            description:
              enquiry.Remarks || enquiry.remarks || enquiry.description || '',
            createdAt: createdAt,
            updatedAt: updatedAt,
            deadline:
              enquiry.ShippingDate ||
              enquiry.deadline ||
              enquiry.Deadline ||
              null,
            budget: budget,
            category: enquiry.Category || enquiry.category || 'Other',
            metalType: metalType,
            stoneType: enquiry.StoneType || enquiry.stoneType || 'N/A',
            // Preserve original API fields for editing
            Name: enquiry.Name,
            Remarks: enquiry.Remarks,
            Priority: enquiry.Priority,
            Quantity: enquiry.Quantity,
            Metal: enquiry.Metal,
            MetalWeight: enquiry.MetalWeight,
            DiamondWeight: enquiry.DiamondWeight,
            Stamping: enquiry.Stamping,
            StyleNumber: enquiry.StyleNumber,
            GatiOrderNumber: enquiry.GatiOrderNumber,
            Category: enquiry.Category,
            StoneType: enquiry.StoneType,
            ShippingDate: enquiry.ShippingDate,
            ClientId: enquiry.ClientId,
            AssignedTo:
              enquiry.AssignedTo !== undefined
                ? enquiry.AssignedTo
                : enquiry.assignedTo,
            AssignedDate: enquiry.AssignedDate,
            CurrentStatus: currentStatus,
            CurrentSubStatus: currentSubStatus,
            CreatedDate: enquiry.CreatedDate,
            Summary: enquiry.Summary,
            ReferenceImages: enquiry.ReferenceImages || [],
            ReferenceVideos: enquiry.ReferenceVideos || [],
            Videos: enquiry.Videos || [],
            CoralCode: enquiry.CoralCode,
            CadCode: enquiry.CadCode,
            Coral: enquiry?.Coral || [],
            Cad: enquiry?.Cad || [],
            lastCoral: enquiry?.lastCoral || null,
            lastCad: enquiry?.lastCad || null,
            finalCad: enquiry?.finalCad || null,
            approvedCoral: enquiry?.approvedCoral || null,
            approvedCad: enquiry?.approvedCad || null,
            _originalData: enquiry,
          };

          // Debug: Log first enquiry after normalization
          if (__DEV__ && index === 0) {
            console.log('ðŸ” ========== AFTER NORMALIZATION ==========');
            console.log('ðŸ” Normalized first enquiry id:', normalized.id);
            console.log(
              'ðŸ” Normalized first enquiry title:',
              normalized.title,
            );
            console.log(
              'ðŸ” Normalized first enquiry AssignedTo:',
              normalized.AssignedTo,
            );
            console.log('ðŸ” Has valid id?', !!normalized.id);
            console.log('ðŸ” =========================================');
          }

          return normalized;
        });

        // Return both data and pagination metadata
        return {
          data: normalizedEnquiries,
          pagination,
        };
      },
    }),

    getEnquiryById: builder.query({
      query: id => `/api/enquiries/${id}`,
      providesTags: (result, error, id) => {
        // Only provide tags if result is not null/error
        if (result && result.id && !result.error) {
          // Provide both specific tag (for this enquiry) and general tag (for all enquiries)
          // This ensures cache invalidation works when updateEnquiry invalidates 'Enquiry' tag
          return [
            { type: 'Enquiry', id },
            'Enquiry', // General tag so that any Enquiry invalidation triggers refetch
          ];
        }
        return [];
      },
      transformResponse: async (rawResponse, meta, arg) => {
        // Unwrap common backend wrapper shapes, including nested envelopes.
        let enquiry = rawResponse;
        if (
          rawResponse &&
          typeof rawResponse === 'object' &&
          !rawResponse._id &&
          !rawResponse.id
        ) {
          const candidate =
            rawResponse.enquiry ||
            rawResponse.data?.enquiry ||
            rawResponse.data?.data ||
            rawResponse.data ||
            rawResponse.result?.enquiry ||
            rawResponse.result?.data ||
            rawResponse.result ||
            rawResponse.response?.enquiry ||
            rawResponse.response?.data ||
            rawResponse;
          enquiry = candidate;
        }

        if (!enquiry || enquiry === null || typeof enquiry !== 'object') {
          return {
            id: null,
            title: 'Enquiry not found',
            clientName: 'Unknown Client',
            status: 'pending',
            priority: 'medium',
            description: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            error: true,
          };
        }

        // Additional safety check - ensure enquiry has expected structure
        try {
          // Same normalization logic as getEnquiries for single enquiry
          // Derive from StatusHistory — last entry is the current state
          const singleHistory = enquiry?.StatusHistory;
          const singleLatest =
            Array.isArray(singleHistory) && singleHistory.length > 0
              ? singleHistory[singleHistory.length - 1]
              : null;
          let currentStatus =
            singleLatest?.Status || enquiry?.CurrentStatus || 'pending';
          let createdAt = new Date().toISOString();
          let updatedAt = new Date().toISOString();

          let normalizedPriority = 'medium';
          const priority = (
            enquiry?.Priority ||
            enquiry?.priority ||
            ''
          ).toLowerCase();
          if (priority.includes('urgent') || priority === 'high') {
            normalizedPriority = 'high';
          } else if (priority === 'low') {
            normalizedPriority = 'low';
          } else {
            normalizedPriority = 'medium';
          }

          let normalizedStatus = 'pending';
          const status = currentStatus.toLowerCase();
          if (status === 'enquiry created' || status === 'pending') {
            normalizedStatus = 'pending';
          } else if (
            status.includes('design approval') ||
            (status.includes('approval') && status.includes('pending'))
          ) {
            normalizedStatus = 'approval_pending';
          } else if (status.includes('approved') && status.includes('cad')) {
            normalizedStatus = 'approved_cad';
          } else if (status.includes('quotation')) {
            normalizedStatus = 'quotation';
          } else if (status === 'coral') {
            normalizedStatus = 'coral';
          } else if (status === 'cad') {
            normalizedStatus = 'cad';
          } else if (status.includes('order')) {
            normalizedStatus = 'order_placement';
          } else if (status.includes('production')) {
            normalizedStatus = 'production';
          } else if (status.includes('shipped')) {
            normalizedStatus = 'shipped';
          } else if (
            status.includes('completed') ||
            status.includes('approved')
          ) {
            normalizedStatus = 'completed';
          } else if (status.includes('rejected')) {
            normalizedStatus = 'rejected';
          } else if (status.includes('pending')) {
            normalizedStatus = 'pending';
          } else {
            normalizedStatus = 'in_progress';
          }

          const metalColor =
            enquiry?.Metal?.Color || enquiry?.metal?.color || '';
          const metalQuality =
            enquiry?.Metal?.Quality || enquiry?.metal?.quality || '';
          const metalType = metalColor
            ? `${metalColor}${metalQuality ? ` (${metalQuality})` : ''}`
            : 'N/A';

          let budget = 0;
          if (
            enquiry?.Coral &&
            Array.isArray(enquiry.Coral) &&
            enquiry.Coral.length > 0
          ) {
            const latestCoral = enquiry.Coral[enquiry.Coral.length - 1];
            if (latestCoral?.Pricing?.TotalPrice) {
              budget = latestCoral.Pricing.TotalPrice;
            }
          }

          // Get client name
          let clientName = 'Unknown Client';
          if (enquiry?.ClientName || enquiry?.clientName) {
            clientName = enquiry.ClientName || enquiry.clientName;
          }

          // Normalize images
          const normalizeImages = imageArray => {
            if (!Array.isArray(imageArray)) return [];

            return imageArray
              .map(img => {
                if (typeof img === 'string') return img;
                if (typeof img === 'object' && img !== null) {
                  if (img.Url || img.url || img.URI || img.uri) {
                    return img.Url || img.url || img.URI || img.uri;
                  }
                  return img;
                }
                return null;
              })
              .filter(img => img !== null && img !== '');
          };

          let images = [];
          if (
            enquiry?.ReferenceImages &&
            Array.isArray(enquiry.ReferenceImages) &&
            enquiry.ReferenceImages.length > 0
          ) {
            images = normalizeImages(enquiry.ReferenceImages);
          } else if (
            enquiry?.Images &&
            Array.isArray(enquiry.Images) &&
            enquiry.Images.length > 0
          ) {
            images = normalizeImages(enquiry.Images);
          } else if (
            enquiry?.images &&
            Array.isArray(enquiry.images) &&
            enquiry.images.length > 0
          ) {
            images = normalizeImages(enquiry.images);
          }

          // Also check for ReferenceVideos (videos might be stored separately by backend)
          let videos = [];
          if (
            enquiry?.ReferenceVideos &&
            Array.isArray(enquiry.ReferenceVideos) &&
            enquiry.ReferenceVideos.length > 0
          ) {
            videos = normalizeImages(enquiry.ReferenceVideos);
          } else if (
            enquiry?.Videos &&
            Array.isArray(enquiry.Videos) &&
            enquiry.Videos.length > 0
          ) {
            videos = normalizeImages(enquiry.Videos);
          }

          // Debug logging to see what backend returns
          if (__DEV__) {
            console.log('ðŸ” [getEnquiryById] Media data from backend:', {
              hasReferenceImages: !!(
                enquiry?.ReferenceImages &&
                Array.isArray(enquiry.ReferenceImages)
              ),
              referenceImagesCount: enquiry?.ReferenceImages?.length || 0,
              hasReferenceVideos: !!(
                enquiry?.ReferenceVideos &&
                Array.isArray(enquiry.ReferenceVideos)
              ),
              referenceVideosCount: enquiry?.ReferenceVideos?.length || 0,
              imagesNormalized: images.length,
              videosNormalized: videos.length,
            });
          }

          if (
            images.length === 0 &&
            enquiry?.Coral &&
            Array.isArray(enquiry.Coral) &&
            enquiry.Coral.length > 0
          ) {
            const latestCoral = enquiry.Coral[enquiry.Coral.length - 1];
            if (
              latestCoral?.Images &&
              Array.isArray(latestCoral.Images) &&
              latestCoral.Images.length > 0
            ) {
              images = normalizeImages(latestCoral.Images);
            }
          }

          if (
            images.length === 0 &&
            enquiry?.Cad &&
            Array.isArray(enquiry.Cad) &&
            enquiry.Cad.length > 0
          ) {
            const latestCad = enquiry.Cad[enquiry.Cad.length - 1];
            if (
              latestCad?.Images &&
              Array.isArray(latestCad.Images) &&
              latestCad.Images.length > 0
            ) {
              images = normalizeImages(latestCad.Images);
            }
          }

          return {
            id: enquiry?._id || enquiry?.id || null,
            title:
              enquiry?.Name ||
              enquiry?.name ||
              enquiry?.title ||
              'Untitled Enquiry',
            clientId: enquiry?.ClientId || enquiry?.clientId || '',
            clientName: clientName,
            client: clientName,
            status: normalizedStatus,
            priority: normalizedPriority,
            description:
              enquiry?.Remarks ||
              enquiry?.remarks ||
              enquiry?.description ||
              '',
            createdAt: createdAt,
            updatedAt: updatedAt,
            deadline:
              enquiry?.ShippingDate ||
              enquiry?.deadline ||
              enquiry?.Deadline ||
              null,
            budget: budget,
            estimatedPrice: budget,
            category: enquiry?.Category || enquiry?.category || 'Other',
            metalType: metalType,
            stoneType: enquiry?.StoneType || enquiry?.stoneType || 'N/A',
            images: images,
            coralVersion:
              enquiry?.CoralCode ||
              enquiry?.coralCode ||
              (enquiry?.Coral?.length > 0
                ? enquiry.Coral[enquiry.Coral.length - 1]?.Code
                : null),
            cadVersion:
              enquiry?.CadCode ||
              enquiry?.cadCode ||
              (enquiry?.Cad?.length > 0
                ? enquiry.Cad[enquiry.Cad.length - 1]?.Code
                : null),
            // Preserve original API fields
            Name: enquiry?.Name,
            Summary: enquiry?.Summary,
            // Checklist is a JSON object â€” preserve as-is
            Checklist: enquiry?.Checklist || null,
            Remarks: enquiry?.Remarks,
            Priority: enquiry?.Priority,
            Quantity: enquiry?.Quantity,
            Metal: enquiry?.Metal,
            MetalWeight: enquiry?.MetalWeight,
            DiamondWeight: enquiry?.DiamondWeight,
            Stamping: enquiry?.Stamping,
            StyleNumber: enquiry?.StyleNumber,
            GatiOrderNumber: enquiry?.GatiOrderNumber,
            Category: enquiry?.Category,
            StoneType: enquiry?.StoneType,
            ShippingDate: enquiry?.ShippingDate,
            ClientId: enquiry?.ClientId,
            AssignedTo: enquiry?.AssignedTo,
            CurrentStatus: singleLatest?.Status,
            CurrentSubStatus: singleLatest?.SubStatus,
            CoralCode: enquiry?.CoralCode,
            CadCode: enquiry?.CadCode,
            // CRITICAL: Preserve Coral and Cad arrays with Pricing data
            Coral: enquiry?.Coral || [],
            Cad: enquiry?.Cad || [],
            lastCoral: enquiry?.lastCoral || null,
            lastCad: enquiry?.lastCad || null,
            // Preserve ReferenceVideos if they exist
            ReferenceVideos: enquiry?.ReferenceVideos || [],
            Videos: enquiry?.Videos || [],
            _originalData: enquiry,
          };
        } catch (transformError) {
          // Return fallback object if transformation fails
          return {
            id: enquiry._id || enquiry.id || null,
            title:
              enquiry.Name ||
              enquiry.name ||
              enquiry.title ||
              'Untitled Enquiry',
            clientName:
              enquiry.ClientName || enquiry.clientName || 'Unknown Client',
            status: 'pending',
            priority: 'medium',
            description:
              enquiry.Remarks || enquiry.remarks || enquiry.description || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            error: true,
            // CRITICAL: Preserve Coral and Cad arrays with Pricing data even in error case
            Coral: enquiry?.Coral || [],
            Cad: enquiry?.Cad || [],
            _originalData: enquiry,
          };
        }
      },
      transformErrorResponse: (response, meta, arg) => {
        // Handle API errors (404, 500, etc.)

        return {
          error: true,
          message:
            response.data?.error ||
            response.data?.message ||
            'Failed to load enquiry',
          status: response.status,
        };
      },
    }),

    createEnquiry: builder.mutation({
      queryFn: async (data, { dispatch }, extraOptions, baseQuery) => {
        console.log('ðŸŒ Timestamp:', new Date().toISOString());
        console.log('ðŸŒ Request Payload:', JSON.stringify(data, null, 2));
        console.log('ðŸŒ Payload Size:', JSON.stringify(data).length, 'bytes');
        console.log('ðŸŒ Payload Summary:', {
          Name: data.Name,
          ClientId: data.ClientId,
          Priority: data.Priority,
          Category: data.Category,
          StoneType: data.StoneType,
          Quantity: data.Quantity,
          'Has Reference Images': !!data.ReferenceImages,
          'Reference Images Count': data.ReferenceImages?.length || 0,
          'Has Metal Weight': !!(
            data.MetalWeight?.From ||
            data.MetalWeight?.To ||
            data.MetalWeight?.Exact
          ),
          'Has Diamond Weight': !!(
            data.DiamondWeight?.From ||
            data.DiamondWeight?.To ||
            data.DiamondWeight?.Exact
          ),
        });

        try {
          const result = await baseQuery({
            url: '/api/enquiries',
            method: 'POST',
            body: data,
          });

          if (result.error) {
            console.error(
              'âŒ API Error Response:',
              JSON.stringify(result.error, null, 2),
            );
            return result;
          }

          console.log(
            'âœ… API Success Response:',
            JSON.stringify(result.data, null, 2),
          );
          console.log('âœ… Response Summary:', {
            Status: 'Success',
            'Enquiry ID': result.data?.id || result.data?._id || 'Not returned',
            Name: result.data?.Name || result.data?.name || data.Name,
          });

          return result;
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', data: error.message } };
        }
      },
      invalidatesTags: ['Enquiry', 'Dashboard'],
    }),

    updateEnquiry: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `/api/enquiries/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'Enquiry', id },
        'Enquiry',
        'Dashboard',
        'StatusStatistics',
      ],
    }),

    deleteEnquiry: builder.mutation({
      query: id => ({
        url: `/api/enquiries/${id}`,
        method: 'DELETE',
      }),
      // Optimistic update: Remove enquiry from cache immediately
      onQueryStarted: async (id, { dispatch, queryFulfilled, getState }) => {
        // Optimistically remove from enquiries list cache
        const patchResult = dispatch(
          api.util.updateQueryData('getEnquiries', undefined, draft => {
            if (Array.isArray(draft)) {
              const index = draft.findIndex(e => (e.id || e._id) === id);
              if (index !== -1) {
                draft.splice(index, 1);
              }
            }
          }),
        );

        // Also try to update role-specific queries
        try {
          const state = getState();
          const authState = state.auth;
          const role = authState?.user?.role || 'admin';

          // Update role-specific query cache
          dispatch(
            api.util.updateQueryData('getEnquiries', role, draft => {
              if (Array.isArray(draft)) {
                const index = draft.findIndex(e => (e.id || e._id) === id);
                if (index !== -1) {
                  draft.splice(index, 1);
                }
              }
            }),
          );
        } catch (e) {
          // Ignore if role-specific query doesn't exist in cache
        }

        try {
          await queryFulfilled;
          // Success - only invalidate dashboard to refresh stats
          dispatch(api.util.invalidateTags(['Dashboard']));
        } catch (error) {
          // Rollback on error
          patchResult.undo();
          // Still invalidate tags to ensure consistency
          dispatch(api.util.invalidateTags(['Enquiry', 'Dashboard']));
        }
      },
      // Fallback invalidation (only if optimistic update fails)
      invalidatesTags: (result, error, id) => {
        // Only invalidate if mutation failed (optimistic update will handle success)
        if (error) {
          return [
            { type: 'Enquiry', id },
            'Enquiry',
            'Dashboard',
            'StatusStatistics',
          ];
        }
        return ['Dashboard', 'StatusStatistics']; // Only refresh dashboard stats
      },
    }),

    getClients: builder.query({
      query: () => '/api/clients',
      providesTags: ['Client'],
      transformResponse: data => {
        let clientsArray = [];
        if (Array.isArray(data)) {
          clientsArray = data;
        } else if (data.clients && Array.isArray(data.clients)) {
          clientsArray = data.clients;
        } else if (data.data && Array.isArray(data.data)) {
          clientsArray = data.data;
        } else {
          return [];
        }

        return clientsArray.map(client => ({
          id: client.Id || client.id || client._id,
          _id: client._id || client.Id || client.id, // Also store _id for compatibility
          name: client.Name || client.name || 'Unknown Client',
          email: client.Email || client.email || 'N/A',
          phone: client.Phone || client.phone || 'N/A',
          totalOrders: client.TotalOrders || client.totalOrders || 0,
          totalSpent: client.TotalSpent || client.totalSpent || 0,
          lastOrder: client.LastOrder || client.lastOrder || null,
          imageUrl:
            client.ImageUrl ||
            client.imageUrl ||
            client.Image ||
            client.image ||
            client.Logo ||
            client.logo ||
            null,
        }));
      },
    }),

    createClient: builder.mutation({
      query: ({ Name, ImageUrl, Pricing }) => ({
        url: '/api/clients',
        method: 'POST',
        body: {
          Name,
          ...(ImageUrl && { ImageUrl }),
          ...(Pricing && { Pricing }),
        },
      }),
      invalidatesTags: ['Client'],
      transformResponse: response => {
        return {
          success: true,
          client: response.client || response,
          message: response.message || 'Client created successfully',
        };
      },
      transformErrorResponse: response => {
        return {
          success: false,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to create client',
        };
      },
    }),

    getDepartments: builder.query({
      query: () => '/api/departments',
      providesTags: ['Client'],
      transformResponse: data => {
        let arr = [];
        if (Array.isArray(data)) arr = data;
        else if (data?.departments && Array.isArray(data.departments))
          arr = data.departments;
        else if (data?.data && Array.isArray(data.data)) arr = data.data;
        else return [];
        return arr.map(dept => ({
          id: dept._id || dept.Id || dept.id,
          _id: dept._id || dept.Id || dept.id,
          name: dept.Name || dept.name || 'Unknown Department',
          email: dept.Email || dept.email || 'N/A',
        }));
      },
    }),

    getClientById: builder.query({
      query: clientId => `/api/clients/${clientId}`,
      providesTags: (result, error, clientId) => [
        { type: 'Client', id: clientId },
      ],
    }),

    updateClientPricing: builder.mutation({
      query: ({ clientId, ...data }) => {
        // Extract PricingMessageFormat from data if it exists
        const { PricingMessageFormat, pricingMessageFormat, ...restData } =
          data;
        const messageFormat = PricingMessageFormat || pricingMessageFormat;

        return {
          url: `/api/clients/${clientId}`,
          method: 'PUT',
          body: {
            Id: clientId,
            ...(messageFormat && { PricingMessageFormat: messageFormat }),
            ...restData,
          },
        };
      },
      invalidatesTags: (result, error, { clientId }) => [
        { type: 'Client', id: clientId },
        'Client',
        // Also invalidate all Enquiry caches since pricing affects enquiry pricing calculations
        'Enquiry',
        // Invalidate Dashboard cache as it may show pricing-related data
        'Dashboard',
      ],
    }),

    getEnquiryBuckets: builder.query({
      query: clientId => {
        const base = '/api/enquiries/aggregate?groupBy=buckets';
        return clientId ? `${base}&clientId=${clientId}` : base;
      },
      providesTags: ['Enquiry', 'StatusStatistics'],
      transformResponse: data => ({
        unassigned: data?.unassigned ?? 0,
        wip: data?.wip ?? 0,
        approvalPending: data?.approvalPending ?? 0,
      }),
    }),

    getStatusStatistics: builder.query({
      queryFn: async (arg, { dispatch }, extraOptions, baseQuery) => {
        try {
          // Fetch all status counts using aggregate endpoint without assignedTo filter
          const aggregateUrl = '/api/enquiries/aggregate?groupBy=status';

          const response = await baseQuery(aggregateUrl);

          if (response.error) {
            return {
              error: {
                status: response.error.status || 'FETCH_ERROR',
                data:
                  response.error.data || 'Failed to fetch status statistics',
              },
            };
          }

          const statusStats = Array.isArray(response.data) ? response.data : [];

          if (__DEV__) {
            console.log(
              'ðŸ“Š [STATUS STATS API] Total Count:',
              statusStats.reduce((sum, item) => sum + (item.count || 0), 0),
            );
          }

          return {
            data: {
              statusStats,
              total: statusStats.reduce(
                (sum, item) => sum + (item.count || 0),
                0,
              ),
            },
          };
        } catch (error) {
          return {
            error: {
              status: 'CUSTOM_ERROR',
              data: error.message || 'Failed to fetch status statistics',
            },
          };
        }
      },
      providesTags: ['StatusStatistics'],
    }),

    // Dashboard data is computed from aggregate endpoints
    // Uses /api/enquiries/aggregate?groupBy=status and groupBy=client
    getDashboardData: builder.query({
      queryFn: async (arg, { dispatch, getState }, extraOptions, baseQuery) => {
          // Extract role, userId, and clientId from argument
          const role = typeof arg === 'object' ? arg?.role : arg;
          const userId = typeof arg === 'object' ? arg?.userId : undefined;
          const clientId = typeof arg === 'object' ? arg?.clientId : undefined;
        try {

          const isAdmin = role === 'admin' || role === 'AD';
          const isClient = role === 'client' || role === 'CL' || role === 4;
          const roleNumber =
            typeof arg === 'object'
              ? arg?.roleNumber || arg?.roleId
              : undefined;
          const isClientRole = isClient || roleNumber === 4;

          // For Client users (role 4), use ClientId from token, not userId
          const clientFilterId =
            isClientRole && clientId
              ? clientId
              : isClientRole
              ? userId
              : undefined;

          // Build aggregate URLs
          // For status counts: use aggregate endpoint with appropriate filters
          let statusAggregateUrl;
          if (isAdmin) {
            // Admin: Get all status counts
            statusAggregateUrl = '/api/enquiries/aggregate?groupBy=status';
          } else if (isClientRole && clientFilterId) {
            // Client: Filter by ClientId from token
            statusAggregateUrl = `/api/enquiries/aggregate?groupBy=status&clientId=${encodeURIComponent(
              clientFilterId,
            )}`;
          } else {
            // Coral/CAD: Filter by assignedTo
            statusAggregateUrl = `/api/enquiries/aggregate?groupBy=status&assignedTo=${encodeURIComponent(
              userId,
            )}`;
          }

          // For client counts: only for admin users
          const clientAggregateUrl = isAdmin
            ? '/api/enquiries/aggregate?groupBy=client'
            : null;

          // Fetch data in parallel
          const fetchPromises = [
            baseQuery(statusAggregateUrl),
            clientAggregateUrl
              ? baseQuery(clientAggregateUrl)
              : Promise.resolve({ data: null }),
            role === 'admin'
              ? baseQuery('/api/clients')
              : Promise.resolve({ data: [] }),
          ];

          // For revenue calculation, we still need some enquiry data
          // Fetch a reasonable limit of enquiries and filter client-side for completed ones
          let enquiriesSearchUrl;
          if (isAdmin) {
            // For admin, fetch a reasonable number of enquiries for revenue calculation
            enquiriesSearchUrl = '/api/enquiries/search?page=1&limit=1000';
          } else if (isClientRole && clientFilterId) {
            // Client: Use ClientId from token
            enquiriesSearchUrl = `/api/enquiries/search?page=1&limit=100&clientId=${encodeURIComponent(
              clientFilterId,
            )}`;
            if (__DEV__) {
              console.log(
                'ðŸ” [DASHBOARD] Enquiries search using ClientId:',
                clientFilterId,
              );
            }
          } else {
            enquiriesSearchUrl = `/api/enquiries/search?page=1&limit=100&assignedTo=${encodeURIComponent(
              userId,
            )}`;
          }

          fetchPromises.push(baseQuery(enquiriesSearchUrl));

          const [
            statusAggregateResult,
            clientAggregateResult,
            clientsResult,
            enquiriesResult,
          ] = await Promise.all(fetchPromises);

          // Handle status aggregate response and categorize
          let categorizedCounts = {
            Pending: 0,
            'Approval Pending': 0,
            Completed: 0,
            All: 0,
          };

          // Legacy status counts for backward compatibility
          let statusCounts = {
            pending: 0,
            completed: 0,
            rejected: 0,
            total: 0,
          };

          // Process status aggregate data for ALL users (including admin)
          // Also track specific status counts for designers (Coral, CAD, etc.)
          const specificStatusCounts = {};

          if (statusAggregateResult.data && !statusAggregateResult.error) {
            const aggregateData = statusAggregateResult.data;

            // Handle different response formats
            if (Array.isArray(aggregateData)) {
              aggregateData.forEach((item, index) => {
                const statusName = (
                  item.name ||
                  item.status ||
                  item.Status ||
                  item._id ||
                  item.group ||
                  ''
                ).toUpperCase();
                const statusNameLower = statusName.toLowerCase();
                const count =
                  item.count || item.Count || item.value || item.total || 0;

                // Store specific status counts for designers
                specificStatusCounts[statusNameLower] = count;

                // Categorize status into Pending, Approval Pending, or Completed
                let category = 'Pending';
                if (
                  statusName.includes('APPROVAL') &&
                  !statusName.includes('APPROVED')
                ) {
                  category = 'Approval Pending';
                } else if (
                  statusName.includes('APPROVED') ||
                  statusName.includes('COMPLETED')
                ) {
                  category = 'Completed';
                }

                categorizedCounts[category] += count;
                categorizedCounts['All'] += count;

                // Also populate legacy status counts for backward compatibility
                const status = statusNameLower;
                if (
                  status === 'pending' ||
                  status === 'enquiry created' ||
                  status.includes('pending') ||
                  status === 'design approval pending'
                ) {
                  statusCounts.pending += count;
                } else if (
                  status === 'completed' ||
                  status.includes('completed') ||
                  status.includes('approved')
                ) {
                  statusCounts.completed += count;
                } else if (
                  status === 'rejected' ||
                  status.includes('rejected')
                ) {
                  statusCounts.rejected += count;
                } else {
                  // For statuses like coral, cad, progress, etc., count them as pending
                  statusCounts.pending += count;
                }
                statusCounts.total += count;
              });
            } else if (typeof aggregateData === 'object') {
              // Handle object format { pending: 10, completed: 5, ... }
              Object.keys(aggregateData).forEach(key => {
                const normalizedKey = key.toUpperCase();
                const keyLower = key.toLowerCase();
                const value = aggregateData[key];

                // Store specific status counts for designers
                specificStatusCounts[keyLower] = value || 0;

                // Categorize
                let category = 'Pending';
                if (
                  normalizedKey.includes('APPROVAL') &&
                  !normalizedKey.includes('APPROVED')
                ) {
                  category = 'Approval Pending';
                } else if (
                  normalizedKey.includes('APPROVED') ||
                  normalizedKey.includes('COMPLETED')
                ) {
                  category = 'Completed';
                }

                categorizedCounts[category] += value || 0;
                categorizedCounts['All'] += value || 0;

                // Legacy mapping
                if (keyLower === 'pending' || keyLower.includes('pending')) {
                  statusCounts.pending = value || 0;
                } else if (
                  keyLower === 'completed' ||
                  keyLower.includes('completed')
                ) {
                  statusCounts.completed = value || 0;
                } else if (
                  keyLower === 'rejected' ||
                  keyLower.includes('rejected')
                ) {
                  statusCounts.rejected = value || 0;
                } else if (keyLower === 'total') {
                  statusCounts.total = value || 0;
                } else {
                  // For statuses like coral, cad, progress, etc., count them as pending
                  statusCounts.pending =
                    (statusCounts.pending || 0) + (value || 0);
                }
              });
            }
          } else if (statusAggregateResult.error) {
          }

          // Process client aggregate data for admin users
          let totalClientsFromAggregate = 0;
          let clientAggregateData = null;
          if (
            isAdmin &&
            clientAggregateResult.data &&
            !clientAggregateResult.error
          ) {
            clientAggregateData = clientAggregateResult.data;

            if (Array.isArray(clientAggregateData)) {
              // Count unique clients from aggregate
              totalClientsFromAggregate = clientAggregateData.length;
            }
          }

          // Handle paginated response from new aggregated endpoint
          const enquiries = Array.isArray(enquiriesResult.data)
            ? enquiriesResult.data
            : enquiriesResult.data?.data ||
              enquiriesResult.data?.enquiries ||
              [];

          // For admin, also check pagination total if available (more accurate than array length)
          const paginationTotal =
            enquiriesResult.data?.pagination?.total ||
            enquiriesResult.data?.total ||
            null;

          const clients =
            role === 'admin' && clientsResult.data
              ? Array.isArray(clientsResult.data)
                ? clientsResult.data
                : clientsResult.data?.clients || clientsResult.data?.data || []
              : [];

          // Normalize enquiries (updated for aggregated endpoint response)
          const normalizedEnquiries = enquiries.map(enquiry => {
            // Derive from StatusHistory — last entry is the current state
            const dashHistory = enquiry?.StatusHistory;
            const dashLatest =
              Array.isArray(dashHistory) && dashHistory.length > 0
                ? dashHistory[dashHistory.length - 1]
                : null;
            const currentStatus = dashLatest?.Status || 'pending';
            const createdAt =
              enquiry.CreatedDate ||
              enquiry.CreatedAt ||
              new Date().toISOString();
            const updatedAt =
              enquiry.AssignedDate || enquiry.UpdatedAt || createdAt;

            let normalizedPriority = 'medium';
            const priority = (
              enquiry.Priority ||
              enquiry.priority ||
              ''
            ).toLowerCase();
            if (
              priority.includes('urgent') ||
              priority === 'high' ||
              priority === 'super high'
            ) {
              normalizedPriority = 'high';
            } else if (priority === 'low') {
              normalizedPriority = 'low';
            }

            let normalizedStatus = 'pending';
            const status = currentStatus.toLowerCase();
            if (status === 'enquiry created' || status === 'pending') {
              normalizedStatus = 'pending';
            } else if (
              status.includes('design approval') ||
              (status.includes('approval') && status.includes('pending'))
            ) {
              normalizedStatus = 'approval_pending';
            } else if (status.includes('approved') && status.includes('cad')) {
              normalizedStatus = 'approved_cad';
            } else if (status.includes('quotation')) {
              normalizedStatus = 'quotation';
            } else if (status === 'coral') {
              normalizedStatus = 'coral';
            } else if (status === 'cad') {
              normalizedStatus = 'cad';
            } else if (status.includes('order')) {
              normalizedStatus = 'order_placement';
            } else if (status.includes('production')) {
              normalizedStatus = 'production';
            } else if (status.includes('shipped')) {
              normalizedStatus = 'shipped';
            } else if (
              status.includes('completed') ||
              status.includes('approved')
            ) {
              normalizedStatus = 'completed';
            } else if (status.includes('rejected')) {
              normalizedStatus = 'rejected';
            } else if (status.includes('pending')) {
              normalizedStatus = 'pending';
            } else {
              normalizedStatus = 'in_progress';
            }

            let budget = 0;
            if (
              enquiry.Coral &&
              Array.isArray(enquiry.Coral) &&
              enquiry.Coral.length > 0
            ) {
              const latestCoral = enquiry.Coral[enquiry.Coral.length - 1];
              if (latestCoral.Pricing?.TotalPrice) {
                budget = latestCoral.Pricing.TotalPrice;
              }
            }

            return {
              status: normalizedStatus,
              budget: budget,
              estimatedPrice: budget,
            };
          });

          // Calculate dashboard stats based on role
          // All users now use aggregate endpoints for counts
          if (role === 'admin') {
            // Admin: Use aggregate endpoints for counts
            const totalEnquiries =
              categorizedCounts['All'] || statusCounts.total || 0;
            const pendingEnquiries =
              categorizedCounts['Pending'] || statusCounts.pending || 0;
            const approvalPendingEnquiries =
              categorizedCounts['Approval Pending'] || 0;
            const completedEnquiries =
              categorizedCounts['Completed'] || statusCounts.completed || 0;

            // Prefer total count from clients API (includes clients without enquiries)
            // Fallback to aggregate length only when clients API fails/empty
            const totalClients =
              clients.length > 0 ? clients.length : totalClientsFromAggregate;

            // Revenue calculation still needs enquiry data (limited fetch for completed enquiries)
            const revenue = normalizedEnquiries
              .filter(e => {
                const status = (e.status || '').toLowerCase();
                return (
                  status.includes('completed') || status.includes('approved')
                );
              })
              .reduce(
                (sum, e) => sum + parseFloat(e.budget || e.estimatedPrice || 0),
                0,
              );

            const sumOfStatuses =
              pendingEnquiries + approvalPendingEnquiries + completedEnquiries;

            return {
              data: {
                totalEnquiries,
                pendingEnquiries,
                approvalPendingEnquiries,
                completedEnquiries,
                totalClients,
                revenue,
                categorizedCounts,
                clientAggregateData, // Include client aggregate data for mapping counts
              },
            };
          } else if (role === 'client') {
            // For client users, prioritize aggregate API counts, but fallback to counting from filtered enquiries
            // The enquiries array is already filtered by clientId, so we can count from it
            const myEnquiries =
              categorizedCounts['All'] ||
              statusCounts.total ||
              normalizedEnquiries.length;

            // Count from normalizedEnquiries (already filtered by clientId) if aggregate is empty
            const pendingCount = normalizedEnquiries.filter(e => {
              const status = (e.status || '').toLowerCase();
              return (
                status === 'pending' ||
                status === 'enquiry created' ||
                (status.includes('pending') && !status.includes('approval'))
              );
            }).length;
            const approvalPendingCount = normalizedEnquiries.filter(e => {
              const status = (e.status || '').toLowerCase();
              return (
                status.includes('approval') && !status.includes('approved')
              );
            }).length;
            const completedCount = normalizedEnquiries.filter(e => {
              const status = (e.status || '').toLowerCase();
              return (
                status.includes('completed') || status.includes('approved')
              );
            }).length;

            // Use aggregate counts if available, otherwise use counted values
            // Use nullish coalescing (??) instead of || to properly handle 0 values
            const pendingApprovals =
              categorizedCounts['Pending'] ??
              statusCounts.pending ??
              pendingCount ??
              0;
            const approvalPending =
              categorizedCounts['Approval Pending'] ??
              approvalPendingCount ??
              0;
            const completedOrders =
              categorizedCounts['Completed'] ??
              statusCounts.completed ??
              completedCount ??
              0;

            const totalSpent = normalizedEnquiries
              .filter(e => {
                const status = (e.status || '').toLowerCase();
                return (
                  status.includes('completed') || status.includes('approved')
                );
              })
              .reduce(
                (sum, e) => sum + parseFloat(e.budget || e.estimatedPrice || 0),
                0,
              );

            const clientSum =
              pendingApprovals + approvalPending + completedOrders;

            return {
              data: {
                myEnquiries,
                pendingApprovals,
                approvalPending,
                completedOrders,
                totalSpent,
                categorizedCounts,
              },
            };
          } else if (role === 'coral' || role === 'cad') {
            const assignedEnquiries =
              categorizedCounts['All'] ||
              statusCounts.total ||
              normalizedEnquiries.length;
            const completedDesigns =
              categorizedCounts['Completed'] ||
              statusCounts.completed ||
              normalizedEnquiries.filter(e => e.status === 'completed').length;
            // For "Pending Designs", show role-specific count:
            // - Coral role â†’ Coral count
            // - CAD role â†’ CAD count
            const pendingDesigns =
              role === 'coral'
                ? specificStatusCounts['coral'] || 0
                : specificStatusCounts['cad'] || 0;
            const approvalPendingDesigns =
              categorizedCounts['Approval Pending'] || 0;
            const averageRating = 4.8; // TODO: Fetch from API when available

            return {
              data: {
                assignedEnquiries,
                completedDesigns,
                pendingDesigns,
                approvalPendingDesigns,
                averageRating,
                categorizedCounts,
              },
            };
          }

          return { data: {} };
        } catch (error) {
          // Return empty data structure on error
          if (role === 'admin') {
            return {
              data: {
                totalEnquiries: 0,
                pendingEnquiries: 0,
                completedEnquiries: 0,
                totalClients: 0,
                revenue: 0,
              },
            };
          } else if (role === 'client') {
            return {
              data: {
                myEnquiries: 0,
                pendingApprovals: 0,
                completedOrders: 0,
                totalSpent: 0,
              },
            };
          } else if (role === 'coral' || role === 'cad') {
            return {
              data: {
                assignedEnquiries: 0,
                completedDesigns: 0,
                pendingDesigns: 0,
                averageRating: 0,
              },
            };
          }
          return { data: {} };
        }
      },
      providesTags: ['Dashboard'],
    }),

    validateImageUpload: builder.mutation({
      queryFn: async (
        { image, enquiryId },
        { dispatch },
        extraOptions,
        baseQuery,
      ) => {
        const startTime = Date.now();

        if (__DEV__) {
          console.log('ðŸ” [validateImageUpload] ===== START VALIDATION =====');
          console.log(
            'ðŸ” [validateImageUpload] Timestamp:',
            new Date().toISOString(),
          );
          console.log('ðŸ” [validateImageUpload] Enquiry ID:', enquiryId);
          console.log('ðŸ” [validateImageUpload] Image:', {
            uri: image?.uri?.substring(0, 50) + '...',
            type: image?.type,
            name: image?.name,
          });
        }

        try {
          const token = await secureStorage.getItem('token');
          if (!token) {
            if (__DEV__) {
              console.error(
                'âŒ [validateImageUpload] Authentication token not found',
              );
            }
            return {
              error: {
                status: 'CUSTOM_ERROR',
                data: 'Authentication token not found',
              },
            };
          }

          // Create FormData
          const formData = new FormData();

          // Add image file
          const imageFile = {
            uri: image.uri,
            type: image.type || 'image/jpeg',
            name: image.name || `image_${Date.now()}.jpg`,
          };
          formData.append('image', imageFile);

          // Add enquiryId
          formData.append('enquiryId', enquiryId);

          const endpoint = '/api/validate-image';
          const fullUrl = `${API_BASE_URL}${endpoint}`;

          if (__DEV__) {
            console.log('ðŸ“¤ [validateImageUpload] Request:', {
              endpoint: fullUrl,
              enquiryId,
              imageFile: {
                uri: imageFile.uri?.substring(0, 50) + '...',
                type: imageFile.type,
                name: imageFile.name,
              },
            });
          }

          const requestStartTime = Date.now();
          const response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          });

          const requestDuration = Date.now() - requestStartTime;

          if (__DEV__) {
            console.log('ðŸ“¡ [validateImageUpload] Response received:', {
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              requestDuration: `${requestDuration}ms`,
            });
          }

          if (response.ok) {
            const data = await response.json();
            const totalDuration = Date.now() - startTime;

            if (__DEV__) {
              console.log('âœ… [validateImageUpload] SUCCESS');
              console.log('ðŸ“Š Response Data:', JSON.stringify(data, null, 2));
              console.log('â±ï¸  Total Duration:', `${totalDuration}ms`);
            }

            return { data };
          } else {
            const totalDuration = Date.now() - startTime;
            let errorData;
            let errorText = '';

            try {
              errorText = await response.text();
              try {
                errorData = errorText
                  ? JSON.parse(errorText)
                  : { message: 'Validation failed' };
              } catch (jsonError) {
                errorData = {
                  message:
                    errorText ||
                    `Validation failed with status ${response.status}`,
                  rawError: errorText,
                };
              }
            } catch (parseError) {
              errorData = {
                message: `Validation failed with status ${response.status}`,
              };
            }

            if (__DEV__) {
              console.log('âŒ [validateImageUpload] FAILED');
              console.log(
                'ðŸ“Š Response Status:',
                response.status,
                response.statusText,
              );
              console.log(
                'âŒ Error Message:',
                errorData?.message || 'Unknown error',
              );
              console.log('ðŸ“„ Error Data:', errorData);
              console.log('â±ï¸  Total Duration:', `${totalDuration}ms`);
            }

            return {
              error: {
                status: response.status,
                data: errorData,
              },
            };
          }
        } catch (error) {
          const totalDuration = Date.now() - startTime;

          if (__DEV__) {
            console.log('ðŸ’¥ [validateImageUpload] EXCEPTION');
            console.error('âŒ Error:', error);
            console.error('âŒ Error Message:', error.message);
            console.log('â±ï¸  Total Duration:', `${totalDuration}ms`);
          }

          return {
            error: {
              status: 'CUSTOM_ERROR',
              data: error.message || 'Failed to validate image',
            },
          };
        }
      },
    }),

    uploadDesign: builder.mutation({
      queryFn: async (
        {
          enquiryId,
          designType,
          version,
          images,
          excel,
          designCode,
          cost,
          isFinalVersion,
        },
        { dispatch },
        extraOptions,
        baseQuery,
      ) => {
        const startTime = Date.now();

        // Note: invalidatesTags is set in the mutation definition below
        try {
          const token = await secureStorage.getItem('token');
          if (!token) {
            if (__DEV__) {
              console.error('âŒ [uploadDesign] Authentication token not found');
            }
            return {
              error: {
                status: 'CUSTOM_ERROR',
                data: 'Authentication token not found',
              },
            };
          }

          if (__DEV__) {
            console.log('âœ… [uploadDesign] Authentication token found');
          }

          // Create FormData
          const formData = new FormData();

          // Helper function to detect if a file is a video
          const isVideoFile = file => {
            if (file.type) {
              return file.type.startsWith('video/');
            }
            if (file.name) {
              return /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp|m4v)$/i.test(
                file.name,
              );
            }
            return false;
          };

          // Log input parameters BEFORE processing
          if (__DEV__) {
            console.log('ðŸ” [uploadDesign] Input parameters:', {
              enquiryId,
              designType,
              version: version,
              versionType: typeof version,
              imagesCount: images?.length || 0,
              images:
                images?.map(img => ({
                  uri: img.uri?.substring(0, 50) + '...',
                  type: img.type,
                  name: img.name,
                  hasWidth: 'width' in img,
                  hasHeight: 'height' in img,
                  hasFileSize: 'fileSize' in img,
                  hasSize: 'size' in img,
                  allKeys: Object.keys(img || {}),
                })) || [],
              hasExcel: !!excel,
              excel: excel
                ? {
                    uri: excel.uri?.substring(0, 50) + '...',
                    type: excel.type,
                    name: excel.name,
                    allKeys: Object.keys(excel || {}),
                  }
                : null,
              designCode,
              cost,
            });
          }

          // Add version - backend might expect just the number, not "Version X" format
          // Extract numeric version value
          let versionValue = version;
          if (typeof version === 'string') {
            // If it's "Version 1" format, extract the number
            const match = version.match(/\d+/);
            if (match) {
              versionValue = parseInt(match[0], 10);
            } else {
              // Try to parse as number
              const parsed = parseInt(version, 10);
              versionValue = isNaN(parsed) ? 1 : parsed;
            }
          } else if (typeof version === 'number') {
            versionValue = version;
          } else {
            versionValue = 1; // Default
          }

          if (__DEV__) {
            console.log('ðŸ” [uploadDesign] Version processing:', {
              originalVersion: version,
              processedVersion: versionValue,
              versionString: versionValue.toString(),
            });
          }

          // Send as string but ensure it's a valid number string
          formData.append('version', versionValue.toString());

          // Add design code - backend expects field name 'code' (not CoralCode/CadCode)
          // Backend determines type from endpoint URL (/upload/coral vs /upload/cad)
          if (designCode && designCode.trim()) {
            formData.append('code', designCode.trim());
          }

          // Add cost if provided
          if (cost !== undefined && cost !== null && cost !== '') {
            formData.append('cost', String(cost));
          }

          // Add isFinalVersion flag for Final CAD uploads
          if (isFinalVersion) {
            formData.append('isFinalVersion', 'true');
          }

          // Separate images and videos - backend expects them in separate fields
          const imageFiles = [];
          const videoFiles = [];

          // Backend accepted video formats per spec
          const ACCEPTED_VIDEO_TYPES = [
            'video/mp4',
            'video/mpeg',
            'video/quicktime', // MOV
            'video/x-msvideo', // AVI
            'video/webm',
          ];

          // Validate video file before processing
          const validateVideoFile = file => {
            if (!file.uri) {
              throw new Error('Video file URI is missing');
            }

            // Check MIME type if available
            if (file.type && !ACCEPTED_VIDEO_TYPES.includes(file.type)) {
              // Log warning but don't fail - backend will handle validation
              if (__DEV__) {
                console.warn(
                  `âš ï¸ [uploadDesign] Video type ${file.type} may not be fully supported by backend`,
                );
              }
            }

            return true;
          };

          if (images && images.length > 0) {
            images.forEach((image, index) => {
              const isVideo = isVideoFile(image);
              const defaultType = isVideo ? 'video/mp4' : 'image/jpeg';
              const defaultExtension = isVideo ? 'mp4' : 'jpg';
              const defaultName = `file_${index}_${Date.now()}.${defaultExtension}`;

              // Validate video files
              if (isVideo) {
                try {
                  validateVideoFile(image);
                } catch (validationError) {
                  if (__DEV__) {
                    console.error(
                      `âŒ [uploadDesign] Video validation failed for file ${index}:`,
                      validationError,
                    );
                  }
                  // Skip invalid videos
                  return;
                }
              }

              // Create a clean file object with ONLY required fields
              // Use plain object literal (not Object.create(null)) for React Native FormData compatibility
              // React Native FormData requires objects with Object prototype for proper serialization
              // CRITICAL: Only include uri, type, and name - nothing else!
              const fileObject = {
                uri: String(image.uri || ''), // Ensure it's a string
                type: String(image.type || defaultType), // Ensure it's a string
                name: String(image.name || defaultName), // Ensure it's a string
              };

              // Log each file object being created
              if (__DEV__) {
                console.log(
                  `ðŸ” [uploadDesign] File ${index} (${
                    isVideo ? 'VIDEO' : 'IMAGE'
                  }):`,
                  {
                    originalImage: {
                      uri: image.uri?.substring(0, 50) + '...',
                      fullUri: image.uri, // Log full URI for debugging
                      uriType: image.uri?.startsWith('content://')
                        ? 'content://'
                        : image.uri?.startsWith('file://')
                        ? 'file://'
                        : 'other',
                      type: image.type,
                      name: image.name,
                      allKeys: Object.keys(image || {}),
                      hasFileSize: 'fileSize' in (image || {}),
                      hasDuration: 'duration' in (image || {}),
                      hasWidth: 'width' in (image || {}),
                      hasHeight: 'height' in (image || {}),
                      fileSize: image.fileSize,
                      duration: image.duration,
                      width: image.width,
                      height: image.height,
                    },
                    fileObject: {
                      uri: fileObject.uri?.substring(0, 50) + '...',
                      fullUri: fileObject.uri, // Log full URI for debugging
                      uriType: fileObject.uri?.startsWith('content://')
                        ? 'content://'
                        : fileObject.uri?.startsWith('file://')
                        ? 'file://'
                        : 'other',
                      type: fileObject.type,
                      name: fileObject.name,
                      allKeys: Object.keys(fileObject),
                      // Log the exact object being sent to FormData
                      fullFileObject: fileObject,
                    },
                  },
                );
              }

              // For coral/CAD design uploads, backend may expect videos in 'images' field
              // This is different from reference uploads which use separate 'videos' field
              // Try sending videos in 'images' field first (backend may not support separate 'videos' field for design uploads)
              if (isVideo) {
                // For videos, ensure we're using the correct MIME type
                // Backend expects: video/mp4, video/mpeg, video/quicktime, video/x-msvideo, video/webm
                if (
                  fileObject.type &&
                  !fileObject.type.match(
                    /^video\/(mp4|mpeg|quicktime|x-msvideo|webm)$/i,
                  )
                ) {
                  // If type doesn't match accepted formats, default to mp4
                  fileObject.type = 'video/mp4';
                  if (__DEV__) {
                    console.warn(
                      `âš ï¸ [uploadDesign] Video type adjusted to video/mp4 for file: ${fileObject.name}`,
                    );
                  }
                }
                // Send videos in 'images' field for design uploads (coral/CAD)
                // Backend may not support separate 'videos' field for this endpoint
                formData.append('images', fileObject);
                videoFiles.push(fileObject);
                if (__DEV__) {
                  console.log(
                    `ðŸ“¹ [uploadDesign] Video sent in 'images' field (backend may not support 'videos' field for ${designType} uploads)`,
                  );
                }
              } else {
                formData.append('images', fileObject);
                imageFiles.push(fileObject);
              }
            });
          }

          // Add Excel file if provided
          if (excel) {
            const excelObject = {
              uri: excel.uri,
              type: excel.type || 'application/vnd.ms-excel',
              name: excel.name || `excel_${Date.now()}.xlsx`,
            };

            if (__DEV__) {
              console.log('ðŸ” [uploadDesign] Excel file:', {
                originalExcel: {
                  uri: excel.uri?.substring(0, 50) + '...',
                  type: excel.type,
                  name: excel.name,
                  allKeys: Object.keys(excel || {}),
                },
                excelObject: {
                  uri: excelObject.uri?.substring(0, 50) + '...',
                  type: excelObject.type,
                  name: excelObject.name,
                  allKeys: Object.keys(excelObject),
                },
              });
            }

            formData.append('excel', excelObject);
          }

          const endpoint = `/api/enquiries/${enquiryId}/upload/${designType}`;
          const fullUrl = `${API_BASE_URL}${endpoint}`;

          if (__DEV__) {
            console.log('');
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('âœ… [uploadDesign] ENDPOINT VERIFICATION');
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('ðŸ“ Endpoint Path:', endpoint);
            console.log('ðŸŒ Full URL:', fullUrl);
            console.log('ðŸŽ¨ Design Type:', designType);
            console.log(
              'ðŸ“ Note: Design uploads use /upload/{designType} endpoint',
            );
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('');

            console.log('ðŸ“¤ [uploadDesign] Final FormData Summary:', {
              endpoint: fullUrl,
              designType,
              version: versionValue.toString(),
              imagesCount: imageFiles.length,
              videosCount: videoFiles.length,
              totalInImagesField: imageFiles.length + videoFiles.length, // Videos are sent in 'images' field
              hasExcel: !!excel,
              designCode,
              formDataFields: {
                version: versionValue.toString(),
                ...(designCode ? { code: designCode.trim() } : {}),
                ...(cost !== undefined && cost !== null && cost !== ''
                  ? { cost: String(cost) }
                  : {}),
                images: `${imageFiles.length + videoFiles.length} file(s) (${
                  imageFiles.length
                } images + ${videoFiles.length} videos)`,
                ...(excel ? { excel: '1 file' } : {}),
                note:
                  videoFiles.length > 0
                    ? `Videos sent in 'images' field for ${designType} uploads`
                    : null,
              },
            });

            console.log('ðŸ“‹ [uploadDesign] FormData Details:', {
              images: imageFiles.map(
                (f, i) => `${i + 1}. ${f.name} (${f.type})`,
              ),
              videos: videoFiles.map(
                (f, i) =>
                  `${i + 1}. ${f.name} (${f.type}) - sent in 'images' field`,
              ),
              note:
                videoFiles.length > 0
                  ? `Videos are sent in 'images' field for ${designType} uploads`
                  : null,
              ...(excel
                ? {
                    excel: `${excel.name || 'excel'} (${
                      excel.type || 'application/vnd.ms-excel'
                    })`,
                  }
                : {}),
            });
          }

          if (__DEV__) {
            console.log('ðŸŒ [uploadDesign] Sending HTTP Request...');
            console.log('ðŸŒ [uploadDesign] Request URL:', fullUrl);
            console.log('ðŸŒ [uploadDesign] Request Method: POST');
            console.log('ðŸŒ [uploadDesign] Request Headers:', {
              Authorization: `Bearer ${token.substring(0, 20)}...`,
              'Content-Type': 'multipart/form-data (auto-set by fetch)',
            });
          }

          const requestStartTime = Date.now();
          const response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              // Don't set Content-Type - let fetch set it with boundary for FormData
            },
            body: formData,
          });

          const requestDuration = Date.now() - requestStartTime;

          if (__DEV__) {
            console.log('ðŸ“¡ [uploadDesign] Response received:', {
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              requestDuration: `${requestDuration}ms`,
            });
          }

          if (response.ok) {
            const data = await response.json();
            const totalDuration = Date.now() - startTime;

            if (__DEV__) {
              console.log('');
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log('âœ… [uploadDesign] UPLOAD SUCCESS');
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log(
                'ðŸ“Š Response Status:',
                response.status,
                response.statusText,
              );
              console.log('ðŸ“¦ Response Data:', JSON.stringify(data, null, 2));
              console.log('ðŸ“ˆ Upload Summary:', {
                designType,
                version: versionValue.toString(),
                imagesUploaded: imageFiles.length,
                videosUploaded: videoFiles.length,
                excelUploaded: excel ? 1 : 0,
                totalFilesUploaded:
                  imageFiles.length + videoFiles.length + (excel ? 1 : 0),
              });
              console.log('â±ï¸  Total Duration:', `${totalDuration}ms`);
              console.log('ðŸŒ Endpoint Used:', endpoint);
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log('');
            }

            return { data };
          } else {
            let errorData;
            let errorText = '';
            try {
              errorText = await response.text();

              // Try to extract error message from HTML if it's an HTML error page
              let extractedError = null;
              if (errorText && errorText.includes('<!DOCTYPE html>')) {
                // Try to extract error message from HTML
                const errorMatch =
                  errorText.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                  errorText.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                  errorText.match(/<p[^>]*>([^<]+)<\/p>/i) ||
                  errorText.match(/Error[:\s]+([^<\n]+)/i);
                if (errorMatch && errorMatch[1]) {
                  extractedError = errorMatch[1].trim();
                }

                // Also try to find Java stack traces or error messages
                const javaErrorMatch = errorText.match(
                  /(?:Exception|Error|at\s+[\w\.]+\([^\)]+\))/g,
                );
                if (javaErrorMatch) {
                  extractedError =
                    javaErrorMatch[0] +
                    (extractedError ? ` - ${extractedError}` : '');
                }
              }

              // Try to parse as JSON first
              try {
                errorData = errorText
                  ? JSON.parse(errorText)
                  : { message: 'Upload failed' };
              } catch (jsonError) {
                // If not JSON, use extracted error or raw text
                errorData = {
                  message:
                    extractedError ||
                    errorText ||
                    `Upload failed with status ${response.status}`,
                  rawError: errorText,
                  isHtmlError: errorText.includes('<!DOCTYPE html>'),
                };
              }
            } catch (parseError) {
              errorData = {
                message: `Upload failed with status ${response.status}`,
              };
            }

            const totalDuration = Date.now() - startTime;

            if (__DEV__) {
              console.log('');
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log('âŒ [uploadDesign] UPLOAD FAILED');
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log(
                'ðŸ“Š Response Status:',
                response.status,
                response.statusText,
              );
              console.log('ðŸŒ Endpoint Used:', endpoint);
              console.log('ðŸŽ¨ Design Type:', designType);
              console.log('ðŸ“ Version:', versionValue.toString());
              console.log('ðŸ“¦ Files Attempted:', {
                imagesCount: imageFiles.length,
                videosCount: videoFiles.length,
                excelCount: excel ? 1 : 0,
                totalFiles:
                  imageFiles.length + videoFiles.length + (excel ? 1 : 0),
              });
              console.log(
                'âŒ Error Message:',
                errorData?.message ||
                  errorData?.error ||
                  errorData?.rawError ||
                  'Unknown error',
              );
              console.log('ðŸ“„ Error Data:', errorData);
              console.log(
                'ðŸ“ Error Text (first 500 chars):',
                errorText.substring(0, 500),
              );
              console.log('â±ï¸  Total Duration:', `${totalDuration}ms`);
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log('');
            }

            // Provide more helpful error message for common backend errors
            let userFriendlyMessage =
              errorData?.message ||
              errorData?.error ||
              errorData?.rawError ||
              'Upload failed';

            // Handle HTML error pages (500 errors from backend)
            if (
              errorData?.isHtmlError ||
              (errorText && errorText.includes('<!DOCTYPE html>'))
            ) {
              // Try to extract meaningful error from HTML
              const htmlErrorMatch = errorText.match(
                /(?:Exception|Error|at\s+[\w\.]+\([^\)]+\)|NumberFormatException|For input string[^<\n]+|NullPointerException|IllegalArgumentException)/i,
              );
              if (htmlErrorMatch) {
                const extractedError = htmlErrorMatch[0];
                userFriendlyMessage = `Server error: ${extractedError}\n\nThe backend encountered an error processing your video file. This usually means:\n\n1. Video codec or format not fully supported\n2. File metadata cannot be read\n3. Video file is corrupted\n4. Backend endpoint may not support video uploads for ${designType} designs\n\nPlease try:\n- Converting video to MP4 (H.264 codec)\n- Using a different video file\n- Recording a new video on your device\n- Contact support to verify video support for ${designType} uploads`;
              } else {
                userFriendlyMessage = `Server error (500): The backend encountered an error processing your video for ${designType} design upload.\n\nPossible causes:\n1. Video codec not supported (try MP4 with H.264)\n2. File metadata issues\n3. Video file corruption\n4. Backend endpoint may not support video uploads for ${designType} designs\n\nSolutions:\n- Convert video to MP4 format\n- Try a different video file\n- Record a new video on your device\n- Contact support to verify if ${designType} endpoint supports videos\n- If videos aren't supported, try uploading images instead`;
              }
            } else if (
              errorData?.error &&
              typeof errorData.error === 'string'
            ) {
              if (errorData.error.includes('Pricing')) {
                userFriendlyMessage =
                  'Excel file processing error: Pricing data is missing or invalid. Please ensure your Excel file contains the required pricing columns and try again.';
              } else if (errorData.error.includes('null')) {
                userFriendlyMessage =
                  'Server error: Missing data. Please check that all required fields are provided and try again.';
              } else if (
                errorData.error.includes('For input string') ||
                errorText.includes('For input string')
              ) {
                // Java NumberFormatException - backend trying to parse string as number
                userFriendlyMessage = `Upload error: ${
                  errorData.error || errorText
                }. This may be caused by file metadata. Please try selecting the file again or contact support.`;
              }
            } else if (errorText && errorText.includes('For input string')) {
              userFriendlyMessage = `Upload error: ${errorText}. This may be caused by file metadata. Please try selecting the file again or contact support.`;
            }

            return {
              error: {
                status: response.status,
                data: {
                  ...errorData,
                  message: userFriendlyMessage,
                },
              },
            };
          }
        } catch (error) {
          const totalDuration = Date.now() - startTime;

          if (__DEV__) {
            console.log('');
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('ðŸ’¥ [uploadDesign] EXCEPTION OCCURRED');
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.error('âŒ Error:', error);
            console.error('âŒ Error Message:', error.message);
            console.error('âŒ Error Stack:', error.stack);
            console.log('â±ï¸  Total Duration:', `${totalDuration}ms`);
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('');
          }

          return {
            error: {
              status: 'CUSTOM_ERROR',
              data: error.message || 'Failed to upload design',
            },
          };
        }
      },
      invalidatesTags: (result, error, { enquiryId }) => [
        { type: 'Enquiry', id: enquiryId },
        'Enquiry',
        'Dashboard',
      ],
    }),

    // Update asset image description
    updateAssetDescription: builder.mutation({
      query: ({ enquiryId, designType, version, assetId, description }) => {
        const versionParam = version
          ? `?version=${encodeURIComponent(version)}`
          : '';
        return {
          url: `/api/enquiries/${enquiryId}/upload/${designType}${versionParam}`,
          method: 'PUT',
          body: {
            Id: assetId,
            Description: description,
          },
        };
      },
      invalidatesTags: (result, error, { enquiryId }) => [
        { type: 'Enquiry', id: enquiryId },
        'Enquiry',
      ],
      transformResponse: response => {
        return response;
      },
      transformErrorResponse: response => {
        return {
          status: response.status,
          data: response.data,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to update asset description',
        };
      },
    }),

    // Approve design version
    // intent: 'forApproval' (Cad QR → Design Approval Pending) | 'final' (Cad DAP → Order Placement)
    // Coral always uses IsApprovedVersion (transitions Coral → Cad).
    approveDesignVersion: builder.mutation({
      query: ({ enquiryId, designType, version, intent }) => {
        const versionParam = version
          ? `?version=${encodeURIComponent(version)}`
          : '';

    let body;
    if (designType.toLowerCase() === 'cad') {
      if (intent === 'forApproval') {
        body = { SendForApproval: true };
      } else if (intent === 'approveDesign') {
        body = { IsApprovedVersion: true };
      } else {
        body = { IsFinalVersion: true };
      }
    } else if (designType.toLowerCase() === 'coral') {
      if (intent === 'forApproval') {
        body = { SendForApproval: true };
      } else if (intent === 'approveDesign') {
        body = { IsApprovedVersion: true };
      } else {
        body = { IsApprovedVersion: true };
      }
    } else {
      body = { IsApprovedVersion: true };
    }

    console.log('[approveDesignVersion] enquiryId:', enquiryId, 'designType:', designType, 'version:', version, 'intent:', intent, 'body:', JSON.stringify(body));

        return {
          url: `/api/enquiries/${enquiryId}/upload/${designType}${versionParam}`,
          method: 'PUT',
          body,
        };
      },
      invalidatesTags: (result, error, { enquiryId }) => [
        { type: 'Enquiry', id: enquiryId },
        'Enquiry',
      ],
      transformResponse: response => {
        return response;
      },
      transformErrorResponse: response => {
        return {
          status: response.status,
          data: response.data,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to approve design version',
        };
      },
    }),
    // Save pricing for coral/CAD design
    savePricing: builder.mutation({
      query: ({ enquiryId, designType, version, pricingData }) => {
        const startTime = Date.now();

        if (__DEV__) {
          console.log('ðŸ’¾ [savePricing API] ===== START API CALL =====');
          console.log(
            'ðŸ’¾ [savePricing API] Timestamp:',
            new Date().toISOString(),
          );
          console.log('ðŸ’¾ [savePricing API] Parameters:', {
            enquiryId,
            designType,
            version,
            pricingDataCount: Array.isArray(pricingData)
              ? pricingData.length
              : 1,
            pricingDataIsArray: Array.isArray(pricingData),
          });
        }

        const versionParam = version
          ? `?version=${encodeURIComponent(version)}`
          : '';

        // Wrap pricing array in Pricing key to match web format
        // Web sends: { Pricing: [...] }
        const pricingArray = Array.isArray(pricingData)
          ? pricingData
          : [pricingData];
        const requestBody = {
          Pricing: pricingArray,
        };

        const endpoint = `/api/enquiries/${enquiryId}/upload/${designType}${versionParam}`;

        if (__DEV__) {
          console.log('ðŸ’¾ [savePricing API] Request details:', {
            url: endpoint,
            method: 'PUT',
            versionParam,
            requestBodyIsObject:
              typeof requestBody === 'object' && !Array.isArray(requestBody),
            hasPricingKey: 'Pricing' in requestBody,
            pricingArrayLength: requestBody?.Pricing?.length || 0,
            firstPricingEntry: requestBody?.Pricing?.[0]
              ? {
                  MetalPrice: requestBody.Pricing[0].MetalPrice,
                  DiamondsPrice: requestBody.Pricing[0].DiamondsPrice,
                  TotalPrice: requestBody.Pricing[0].TotalPrice,
                  Metal: requestBody.Pricing[0].Metal,
                  StonesCount: requestBody.Pricing[0].Stones?.length || 0,
                  ClientPricingMessage:
                    requestBody.Pricing[0].ClientPricingMessage || 'MISSING',
                }
              : null,
            allEntriesClientPricingMessages:
              requestBody?.Pricing?.map((entry, idx) => ({
                entryIndex: idx + 1,
                ClientPricingMessage: entry.ClientPricingMessage || 'MISSING',
                hasClientPricingMessage: !!entry.ClientPricingMessage,
                messageLength: entry.ClientPricingMessage?.length || 0,
              })) || [],
            // Log full ClientPricingMessage for each entry to verify it's in the request
            allMessages:
              requestBody?.Pricing?.map(
                (entry, idx) =>
                  `Entry ${idx + 1}: "${
                    entry.ClientPricingMessage || 'MISSING'
                  }"`,
              ) || [],
            // Log the FULL request body to see exactly what's being sent
            fullRequestBodyPreview: JSON.stringify(
              requestBody,
              null,
              2,
            ).substring(0, 2000),
            // Also log just the ClientPricingMessage fields from the full body
            fullRequestBodyClientPricingMessages: JSON.stringify(
              requestBody?.Pricing?.map((entry, idx) => ({
                entryIndex: idx + 1,
                ClientPricingMessage: entry.ClientPricingMessage,
                messageType: typeof entry.ClientPricingMessage,
                messageLength: entry.ClientPricingMessage?.length || 0,
                isString: typeof entry.ClientPricingMessage === 'string',
                isEmpty:
                  !entry.ClientPricingMessage ||
                  entry.ClientPricingMessage.trim() === '',
              })) || [],
              null,
              2,
            ),
          });
        }

        // Log the exact body being sent to verify ClientPricingMessage is included
        if (__DEV__) {
          console.log(
            'ðŸ’¾ [savePricing API] ========== FINAL REQUEST BODY ==========',
          );
          console.log(
            'ðŸ’¾ [savePricing API] Request body type:',
            typeof requestBody,
          );
          console.log(
            'ðŸ’¾ [savePricing API] Request body is object:',
            typeof requestBody === 'object' && !Array.isArray(requestBody),
          );
          console.log(
            'ðŸ’¾ [savePricing API] Has Pricing key:',
            'Pricing' in requestBody,
          );
          console.log(
            'ðŸ’¾ [savePricing API] Pricing array length:',
            requestBody?.Pricing?.length || 0,
          );
          requestBody?.Pricing?.forEach((entry, idx) => {
            console.log(
              `ðŸ’¾ [savePricing API] Entry ${
                idx + 1
              } ClientPricingMessage in body:`,
              entry.ClientPricingMessage || 'MISSING',
            );
            console.log(
              `ðŸ’¾ [savePricing API] Entry ${
                idx + 1
              } has ClientPricingMessage key:`,
              'ClientPricingMessage' in entry,
            );
            console.log(
              `ðŸ’¾ [savePricing API] Entry ${
                idx + 1
              } ClientPricingMessage value:`,
              JSON.stringify(entry.ClientPricingMessage),
            );
          });
          console.log(
            'ðŸ’¾ [savePricing API] Full request body JSON:',
            JSON.stringify(requestBody, null, 2),
          );
          console.log(
            'ðŸ’¾ [savePricing API] =========================================',
          );
        }

        // RTK Query automatically serializes objects to JSON
        // But we'll verify the body structure matches web exactly
        if (__DEV__) {
          const stringifiedBody = JSON.stringify(requestBody);
          console.log(
            'ðŸ’¾ [savePricing API] ========== BODY SERIALIZATION CHECK ==========',
          );
          console.log(
            'ðŸ’¾ [savePricing API] Body will be serialized by RTK Query',
          );
          console.log(
            'ðŸ’¾ [savePricing API] Body length (when stringified):',
            stringifiedBody.length,
            'characters',
          );
          // Verify Entry 2's ClientPricingMessage is in the serialized body
          const entry2FullMessage =
            '"ClientPricingMessage":"this is from the mobile test"';
          const entry2MessageIndex = stringifiedBody.indexOf(entry2FullMessage);
          console.log(
            'ðŸ’¾ [savePricing API] Entry 2 full message found at index:',
            entry2MessageIndex !== -1 ? entry2MessageIndex : 'NOT FOUND',
          );
          if (entry2MessageIndex === -1) {
            // Try to find what's actually in the body
            const entry2Partial = stringifiedBody.match(
              /"ClientPricingMessage":"this is from the mobile[^"]*"/,
            );
            console.log(
              'ðŸ’¾ [savePricing API] Entry 2 message found (partial):',
              entry2Partial ? entry2Partial[0] : 'NOT FOUND',
            );
          }
          console.log(
            'ðŸ’¾ [savePricing API] =========================================',
          );
        }

        return {
          url: endpoint,
          method: 'PUT',
          body: requestBody, // RTK Query will automatically serialize this to JSON
          // Note: RTK Query automatically sets Content-Type: application/json
          // Don't override headers - let RTK Query handle it automatically to match web behavior
        };
      },
      invalidatesTags: (result, error, { enquiryId }) => [
        { type: 'Enquiry', id: enquiryId },
        'Enquiry',
        'Dashboard',
      ],
      transformResponse: (response, meta, arg) => {
        if (__DEV__) {
          console.log('âœ… [savePricing API] Response received:', {
            response,
            responseType: typeof response,
            responseKeys: response ? Object.keys(response) : null,
            fullResponse: JSON.stringify(response, null, 2).substring(0, 1000),
          });
        }

        return response;
      },
      transformErrorResponse: (response, meta, arg) => {
        if (__DEV__) {
          console.error('âŒ [savePricing API] ===== ERROR RESPONSE =====');
          console.error('âŒ [savePricing API] Error Status:', response.status);
          console.error('âŒ [savePricing API] Error Data:', response.data);
          console.error(
            'âŒ [savePricing API] Error Data Type:',
            typeof response.data,
          );
          console.error(
            'âŒ [savePricing API] Full Error Response:',
            JSON.stringify(response, null, 2),
          );
          console.error('âŒ [savePricing API] Request Args:', {
            enquiryId: arg?.enquiryId,
            designType: arg?.designType,
            version: arg?.version,
          });

          // Try to extract more error details
          if (response.data) {
            if (typeof response.data === 'string') {
              console.error(
                'âŒ [savePricing API] Error message (string):',
                response.data,
              );
            } else {
              console.error(
                'âŒ [savePricing API] Error message:',
                response.data?.message,
              );
              console.error(
                'âŒ [savePricing API] Error error:',
                response.data?.error,
              );
              console.error(
                'âŒ [savePricing API] Error details:',
                response.data?.details,
              );
            }
          }
          console.error('âŒ [savePricing API] ===== END ERROR LOG =====');
        }

        return {
          status: response.status,
          data: response.data,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to save pricing',
        };
      },
    }),

    // Reject design version
    rejectDesignVersion: builder.mutation({
  query: ({ enquiryId, designType, version, reason }) => {
    const versionParam = version
      ? `?version=${encodeURIComponent(version)}`
      : '';
    return {
      url: `/api/enquiries/${enquiryId}/upload/${designType}${versionParam}`,
      method: 'PUT',
      body: { IsApprovedVersion: false, ReasonForRejection: reason || '' },
    };
  },
  invalidatesTags: (result, error, { enquiryId }) => [
    { type: 'Enquiry', id: enquiryId },
    'Enquiry',
  ],
  transformResponse: response => {
    return response;
  },
  transformErrorResponse: response => {
    return {
      status: response.status,
      data: response.data,
      error:
        response.data?.message ||
        response.data?.error ||
        'Failed to reject design version',
    };
  },
}),
    // Show to Client - Toggle visibility for clients
    updateShowToClient: builder.mutation({
      query: ({ enquiryId, designType, version, showToClient }) => {
        const versionParam = version
          ? `?version=${encodeURIComponent(version)}`
          : '';

        return {
          url: `/api/enquiries/${enquiryId}/upload/${designType}${versionParam}`,
          method: 'PUT',
          body: {
            ShowToClient: showToClient,
          },
        };
      },
      invalidatesTags: (result, error, { enquiryId }) => [
        { type: 'Enquiry', id: enquiryId },
        'Enquiry',
      ],
      transformResponse: response => {
        return response;
      },
      transformErrorResponse: response => {
        return {
          status: response.status,
          data: response.data,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to update ShowToClient',
        };
      },
    }),

    // Delete design version (within 10 minutes of upload)
    deleteDesignVersion: builder.mutation({
      query: ({ enquiryId, designType, version }) => {
        const versionParam = version
          ? `?version=${encodeURIComponent(version)}`
          : '';

        return {
          url: `/api/enquiries/${enquiryId}/upload/${designType}${versionParam}`,
          method: 'DELETE',
        };
      },
      invalidatesTags: (result, error, { enquiryId }) => [
        { type: 'Enquiry', id: enquiryId },
        'Enquiry',
      ],
      transformResponse: response => {
        return response;
      },
      transformErrorResponse: response => {
        return {
          status: response.status,
          data: response.data,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to delete version',
        };
      },
    }),

    // Upload reference images to an enquiry
    uploadReferenceImages: builder.mutation({
      queryFn: async (
        { enquiryId, images },
        { dispatch },
        extraOptions,
        baseQuery,
      ) => {
        const startTime = Date.now();

        if (__DEV__) {
          console.log('ðŸš€ [uploadReferenceImages] ===== START UPLOAD =====');
          console.log(
            'ðŸš€ [uploadReferenceImages] Timestamp:',
            new Date().toISOString(),
          );
          console.log('ðŸš€ [uploadReferenceImages] Enquiry ID:', enquiryId);
          console.log(
            'ðŸš€ [uploadReferenceImages] Total files received:',
            images?.length || 0,
          );
        }

        try {
          const token = await secureStorage.getItem('token');
          if (!token) {
            if (__DEV__) {
              console.error(
                'âŒ [uploadReferenceImages] Authentication token not found',
              );
            }
            return {
              error: {
                status: 'CUSTOM_ERROR',
                data: 'Authentication token not found',
              },
            };
          }

          if (__DEV__) {
            console.log(
              'âœ… [uploadReferenceImages] Authentication token found',
            );
          }

          // Helper function to detect if a file is a video
          const isVideoFile = file => {
            if (file.type) {
              return file.type.startsWith('video/');
            }
            if (file.name) {
              return /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp|m4v)$/i.test(
                file.name,
              );
            }
            return false;
          };

          // Log input parameters BEFORE processing
          if (__DEV__) {
            console.log('ðŸ” [uploadReferenceImages] Input parameters:', {
              enquiryId,
              imagesCount: images?.length || 0,
              images:
                images?.map(img => ({
                  uri: img.uri?.substring(0, 50) + '...',
                  type: img.type,
                  name: img.name,
                  hasWidth: 'width' in img,
                  hasHeight: 'height' in img,
                  hasFileSize: 'fileSize' in img,
                  hasSize: 'size' in img,
                  allKeys: Object.keys(img || {}),
                })) || [],
            });
          }

          // Separate images and videos
          const imageFiles = [];
          const videoFiles = [];

          if (images && images.length > 0) {
            images.forEach((image, index) => {
              const isVideo = isVideoFile(image);
              const defaultType = isVideo ? 'video/mp4' : 'image/jpeg';
              const defaultExtension = isVideo ? 'mp4' : 'jpg';
              const defaultName = `file_${index}_${Date.now()}.${defaultExtension}`;

              // Create a clean file object with ONLY required fields
              // Explicitly create new object to avoid any prototype pollution or extra properties
              // CRITICAL: Only include uri, type, and name - nothing else!
              const fileObject = Object.create(null); // Creates object with no prototype
              fileObject.uri = String(image.uri || ''); // Ensure it's a string
              fileObject.type = String(image.type || defaultType); // Ensure it's a string
              fileObject.name = String(image.name || defaultName); // Ensure it's a string

              // Explicitly delete any potential extra properties (defensive)
              // This shouldn't be necessary but ensures nothing leaks through
              const allowedKeys = ['uri', 'type', 'name'];
              Object.keys(fileObject).forEach(key => {
                if (!allowedKeys.includes(key)) {
                  delete fileObject[key];
                }
              });

              // Log each file object being created
              if (__DEV__) {
                console.log(
                  `ðŸ” [uploadReferenceImages] File ${index} (${
                    isVideo ? 'VIDEO' : 'IMAGE'
                  }):`,
                  {
                    originalImage: {
                      uri: image.uri?.substring(0, 50) + '...',
                      type: image.type,
                      name: image.name,
                      allKeys: Object.keys(image || {}),
                      hasFileSize: 'fileSize' in (image || {}),
                      hasDuration: 'duration' in (image || {}),
                      hasWidth: 'width' in (image || {}),
                      hasHeight: 'height' in (image || {}),
                    },
                    fileObject: {
                      uri: fileObject.uri?.substring(0, 50) + '...',
                      type: fileObject.type,
                      name: fileObject.name,
                      allKeys: Object.keys(fileObject),
                    },
                  },
                );
              }

              if (isVideo) {
                videoFiles.push(fileObject);
              } else {
                imageFiles.push(fileObject);
              }
            });
          }

          if (__DEV__) {
            console.log('ðŸ” [uploadReferenceImages] Separated files:', {
              imageFilesCount: imageFiles.length,
              videoFilesCount: videoFiles.length,
            });
          }

          // Check if we have any files to upload
          if (imageFiles.length === 0 && videoFiles.length === 0) {
            return {
              error: {
                status: 'CUSTOM_ERROR',
                data: 'No files to upload',
              },
            };
          }

          // Upload images and videos together in a single request to /reference endpoint
          if (__DEV__) {
            console.log('ðŸ“¦ [uploadReferenceImages] Creating FormData...');
            console.log('ðŸ“¦ [uploadReferenceImages] Will add to FormData:', {
              imagesCount: imageFiles.length,
              videosCount: videoFiles.length,
            });
          }

          const formData = new FormData();

          // Add images if any
          if (imageFiles.length > 0) {
            if (__DEV__) {
              console.log(
                `ðŸ“Ž [uploadReferenceImages] Adding ${imageFiles.length} image(s) to FormData...`,
              );
            }
            imageFiles.forEach((file, index) => {
              formData.append('images', file);
              if (__DEV__) {
                console.log(
                  `  âœ“ Image ${index + 1}: ${file.name} (${file.type})`,
                );
              }
            });
          }

          // Add videos if any
          if (videoFiles.length > 0) {
            if (__DEV__) {
              console.log(
                `ðŸŽ¬ [uploadReferenceImages] Adding ${videoFiles.length} video(s) to FormData...`,
              );
            }
            videoFiles.forEach((file, index) => {
              formData.append('videos', file);
              if (__DEV__) {
                console.log(
                  `  âœ“ Video ${index + 1}: ${file.name} (${file.type})`,
                );
              }
            });
          }

          const endpoint = `/api/enquiries/${enquiryId}/upload/reference`;
          const fullUrl = `${API_BASE_URL}${endpoint}`;

          // VERIFICATION: Log endpoint to confirm we're using /reference (not /videos)
          if (__DEV__) {
            console.log('');
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('âœ… [VERIFICATION] ENDPOINT VERIFICATION');
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('ðŸ“ Endpoint Path:', endpoint);
            console.log('ðŸŒ Full URL:', fullUrl);
            console.log(
              'âœ… Using /reference endpoint:',
              endpoint.includes('/reference') ? 'YES âœ“' : 'NO âœ—',
            );
            console.log(
              'âŒ Using old /videos endpoint:',
              endpoint.includes('/videos') ? 'YES âœ— (WRONG!)' : 'NO âœ“',
            );
            console.log(
              'ðŸ“ Note: Videos are now uploaded via /reference endpoint',
            );
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('');

            console.log(
              'ðŸ“¤ [uploadReferenceImages] Preparing HTTP Request:',
              {
                method: 'POST',
                url: fullUrl,
                endpoint: endpoint,
                formDataFields: {
                  images:
                    imageFiles.length > 0
                      ? `${imageFiles.length} file(s)`
                      : 'none',
                  videos:
                    videoFiles.length > 0
                      ? `${videoFiles.length} file(s)`
                      : 'none',
                },
                totalFiles: imageFiles.length + videoFiles.length,
              },
            );
            console.log('ðŸ“‹ [uploadReferenceImages] FormData Summary:', {
              images: imageFiles.map(
                (f, i) => `${i + 1}. ${f.name} (${f.type})`,
              ),
              videos: videoFiles.map(
                (f, i) => `${i + 1}. ${f.name} (${f.type})`,
              ),
            });
          }

          if (__DEV__) {
            console.log('ðŸŒ [uploadReferenceImages] Sending HTTP Request...');
            console.log('ðŸŒ [uploadReferenceImages] Request URL:', fullUrl);
            console.log('ðŸŒ [uploadReferenceImages] Request Method: POST');
            console.log('ðŸŒ [uploadReferenceImages] Request Headers:', {
              Authorization: `Bearer ${token.substring(0, 20)}...`,
              'Content-Type': 'multipart/form-data (auto-set by fetch)',
            });
          }

          const requestStartTime = Date.now();
          const response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              // Don't set Content-Type - let fetch set it with boundary for FormData
            },
            body: formData,
          });

          const requestDuration = Date.now() - requestStartTime;

          if (__DEV__) {
            console.log('ðŸ“¡ [uploadReferenceImages] Response received:', {
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              requestDuration: `${requestDuration}ms`,
            });
          }

          if (response.ok) {
            const data = await response.json();
            const totalDuration = Date.now() - startTime;

            if (__DEV__) {
              console.log('');
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log('âœ… [uploadReferenceImages] UPLOAD SUCCESS');
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log(
                'ðŸ“Š Response Status:',
                response.status,
                response.statusText,
              );
              console.log('ðŸ“¦ Response Data:', JSON.stringify(data, null, 2));
              console.log('ðŸ“ˆ Upload Summary:', {
                imagesUploaded: imageFiles.length,
                videosUploaded: videoFiles.length,
                totalFilesUploaded: imageFiles.length + videoFiles.length,
              });
              console.log('â±ï¸  Total Duration:', `${totalDuration}ms`);
              console.log('ðŸŒ Endpoint Used:', endpoint);
              console.log(
                'âœ… Verified: Using /reference endpoint (not /videos)',
              );
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log('');
            }

            return {
              data: {
                success: true,
                imagesUploaded: imageFiles.length,
                videosUploaded: videoFiles.length,
              },
            };
          } else {
            const totalDuration = Date.now() - startTime;
            let errorData;
            let errorText = '';

            if (__DEV__) {
              console.log(
                'âš ï¸  [uploadReferenceImages] Response indicates error (status:',
                response.status,
                ')',
              );
            }

            try {
              errorText = await response.text();
              try {
                errorData = errorText
                  ? JSON.parse(errorText)
                  : { message: 'Upload failed' };
              } catch (jsonError) {
                errorData = {
                  message:
                    errorText || `Upload failed with status ${response.status}`,
                  rawError: errorText,
                };
              }
            } catch (parseError) {
              errorData = {
                message: `Upload failed with status ${response.status}`,
              };
            }

            if (__DEV__) {
              console.log('');
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log('âŒ [uploadReferenceImages] UPLOAD FAILED');
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log(
                'ðŸ“Š Response Status:',
                response.status,
                response.statusText,
              );
              console.log('ðŸŒ Endpoint Used:', endpoint);
              console.log(
                'âœ… Verified: Using /reference endpoint (not /videos)',
              );
              console.log('ðŸ“¦ Files Attempted:', {
                imagesCount: imageFiles.length,
                videosCount: videoFiles.length,
                totalFiles: imageFiles.length + videoFiles.length,
              });
              console.log(
                'âŒ Error Message:',
                errorData?.message ||
                  errorData?.error ||
                  errorData?.rawError ||
                  'Unknown error',
              );
              console.log('ðŸ“„ Error Data:', errorData);
              console.log(
                'ðŸ“ Error Text (first 500 chars):',
                errorText.substring(0, 500),
              );
              console.log('â±ï¸  Total Duration:', `${totalDuration}ms`);
              console.log(
                'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
              );
              console.log('');
            }

            return {
              error: {
                status: response.status,
                data: errorData,
              },
            };
          }
        } catch (error) {
          const totalDuration = Date.now() - startTime;

          if (__DEV__) {
            console.log('');
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('ðŸ’¥ [uploadReferenceImages] EXCEPTION OCCURRED');
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.error('âŒ Error:', error);
            console.error('âŒ Error Message:', error.message);
            console.error('âŒ Error Stack:', error.stack);
            console.log('â±ï¸  Total Duration:', `${totalDuration}ms`);
            console.log(
              'â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
            );
            console.log('');
          }

          return {
            error: {
              status: 'CUSTOM_ERROR',
              data: error.message || 'Failed to upload reference images',
            },
          };
        }
      },
      invalidatesTags: (result, error, { enquiryId }) => [
        { type: 'Enquiry', id: enquiryId },
        'Enquiry',
        'Dashboard',
      ],
    }),

    uploadImage: builder.mutation({
      queryFn: async (image, { dispatch }, extraOptions, baseQuery) => {
        // Try multiple possible upload endpoints (including client-specific)
        const uploadEndpoints = [
          '/api/clients/upload',
          '/api/clients/image/upload',
          '/api/upload',
          '/api/files/upload',
          '/api/images/upload',
          '/api/upload/file',
        ];

        // Try different field names
        const fieldNames = ['file', 'image', 'upload', 'files'];

        const fileName = image.name || `image_${Date.now()}.jpg`;
        const fileType = image.type || 'image/jpeg';

        // Try each endpoint with each field name
        for (const endpoint of uploadEndpoints) {
          for (const fieldName of fieldNames) {
            try {
              // Create FormData
              const formData = new FormData();
              formData.append(fieldName, {
                uri: image.uri,
                type: fileType,
                name: fileName,
              });

              // Get auth token
              const token = await secureStorage.getItem('token');
              const headers = {};
              if (token) {
                headers['Authorization'] = `Bearer ${token}`;
              }

              const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: formData,
              });

              if (response.ok) {
                const data = await response.json();

                return { data };
              } else {
                if (__DEV__) {
                  const errorText = await response.text().catch(() => '');
                }
              }
            } catch (error) {}
          }
        }

        // If all attempts failed, return error
        return {
          error: {
            status: 'CUSTOM_ERROR',
            data: `Failed to upload image. Tried ${
              uploadEndpoints.length * fieldNames.length
            } different endpoint/field combinations.`,
          },
        };
      },
    }),

    getMetalPrices: builder.query({
      query: (useCache = false, useFullEndpoint = false) => {
        const cacheBuster = useCache ? '' : `?t=${Date.now()}`;
        // Option to use full endpoint instead of /latest (for debugging)
        const endpoint = useFullEndpoint
          ? `/api/metal-prices${cacheBuster}`
          : `/api/metal-prices/latest${cacheBuster}`;
        if (__DEV__ && useFullEndpoint) {
          console.log('ðŸ“¥ Using full endpoint instead of /latest');
        }
        return endpoint;
      },
      providesTags: ['MetalPrice'],
      transformResponse: data => {
        let pricesData = {};
        let ids = {};

        if (Array.isArray(data)) {
          data.forEach(item => {
            const metalType = (
              item.MetalType ||
              item.metalType ||
              item.type ||
              ''
            ).toLowerCase();
            const itemId = item.Id || item.id || item._id;
            if (metalType) {
              pricesData[metalType] = {
                price:
                  item.Price ||
                  item.price ||
                  item.PricePerGram ||
                  item.pricePerGram ||
                  0,
                unit: item.Unit || item.unit || 'per gram',
                lastUpdated:
                  item.LastUpdated ||
                  item.lastUpdated ||
                  item.UpdatedAt ||
                  item.updatedAt ||
                  new Date().toISOString(),
              };
              if (itemId) ids[metalType] = itemId;
            }
          });
        } else if (data && typeof data === 'object') {
          if (data.gold || data.silver || data.platinum) {
            const metals = ['gold', 'silver', 'platinum'];
            metals.forEach(metal => {
              const metalData = data[metal];
              if (!metalData) return;

              if (Array.isArray(metalData)) {
                if (metalData.length === 0) return;
                const sortedByDate = [...metalData].sort((a, b) => {
                  const dateA = new Date(a.date || a.Date || 0);
                  const dateB = new Date(b.date || b.Date || 0);
                  return dateB - dateA;
                });
                const latestEntry = sortedByDate[0];
                pricesData[metal] = {
                  price: latestEntry.price || latestEntry.Price || 0,
                  unit: 'per gram',
                  lastUpdated:
                    latestEntry.date ||
                    latestEntry.Date ||
                    new Date().toISOString(),
                };
              } else if (typeof metalData === 'object') {
                const itemId = metalData.Id || metalData.id || metalData._id;
                pricesData[metal] = {
                  price:
                    metalData.Price ||
                    metalData.price ||
                    metalData.PricePerGram ||
                    metalData.pricePerGram ||
                    0,
                  unit: metalData.Unit || metalData.unit || 'per gram',
                  lastUpdated:
                    metalData.LastUpdated ||
                    metalData.lastUpdated ||
                    metalData.UpdatedAt ||
                    metalData.updatedAt ||
                    new Date().toISOString(),
                };
                if (itemId) ids[metal] = itemId;
              }
            });
          } else if (data.prices && typeof data.prices === 'object') {
            pricesData = data.prices;
            if (data.ids && typeof data.ids === 'object') ids = data.ids;
          } else if (data.data && typeof data.data === 'object') {
            pricesData = data.data;
            if (data.ids && typeof data.ids === 'object') ids = data.ids;
          } else {
            Object.keys(data).forEach(key => {
              const item = data[key];
              if (
                item &&
                typeof item === 'object' &&
                (item.price || item.Price)
              ) {
                const itemId = item.Id || item.id || item._id;
                pricesData[key] = {
                  price:
                    item.Price ||
                    item.price ||
                    item.PricePerGram ||
                    item.pricePerGram ||
                    0,
                  unit: item.Unit || item.unit || 'per gram',
                  lastUpdated:
                    item.LastUpdated ||
                    item.lastUpdated ||
                    item.UpdatedAt ||
                    item.updatedAt ||
                    new Date().toISOString(),
                };
                if (itemId) ids[key] = itemId;
              }
            });
          }
        }

        return { prices: pricesData, ids: ids };
      },
    }),

    addMetalPrice: builder.mutation({
      query: data => {
        // Convert date to ISO format with time (backend expects: "2025-11-08T00:00:00.000Z")
        let dateValue = data.date || new Date().toISOString().split('T')[0];

        // If date is just YYYY-MM-DD, convert to exact format: "YYYY-MM-DDTHH:mm:ss.sssZ"
        if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
          dateValue = `${dateValue}T00:00:00.000Z`;
        } else if (!dateValue.includes('T')) {
          try {
            const date = new Date(dateValue);
            if (!isNaN(date.getTime())) {
              dateValue = date.toISOString();
            }
          } catch (e) {
            const today = new Date().toISOString().split('T')[0];
            dateValue = `${today}T00:00:00.000Z`;
          }
        }

        return {
          url: '/api/metal-prices',
          method: 'POST',
          body: {
            metal: data.metal || data.metalType,
            price: data.price,
            date: dateValue,
          },
        };
      },
      invalidatesTags: ['MetalPrice'],
    }),

    updateMetalPrice: builder.mutation({
      query: ({ metal, ...data }) => {
        // Convert date to ISO format with time (backend expects: "2025-11-08T00:00:00.000Z")
        let dateValue = data.date || new Date().toISOString().split('T')[0];

        // If date is just YYYY-MM-DD, convert to exact format: "YYYY-MM-DDTHH:mm:ss.sssZ"
        if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
          // Create date string in exact format without timezone conversion
          dateValue = `${dateValue}T00:00:00.000Z`;
        } else if (!dateValue.includes('T')) {
          // If it's not in the right format, try to convert it
          try {
            const date = new Date(dateValue);
            if (!isNaN(date.getTime())) {
              dateValue = date.toISOString();
            }
          } catch (e) {
            // Fallback: use today's date in correct format
            const today = new Date().toISOString().split('T')[0];
            dateValue = `${today}T00:00:00.000Z`;
          }
        }

        const payload = {
          date: dateValue,
          price: data.price,
        };
        if (__DEV__) {
          console.log(`ðŸ“¤ API: Updating ${metal} price:`, payload);
          console.log(`ðŸ“¤ API: Date format: "${dateValue}"`);
          console.log(`ðŸ“¤ API: Full URL: /api/metal-prices/${metal}`);
        }
        return {
          url: `/api/metal-prices/${metal}`,
          method: 'PUT',
          body: payload,
        };
      },
      transformResponse: (response, meta, arg) => {
        if (__DEV__) {
          console.log(
            `ðŸ“¥ API: ${arg.metal} update raw response:`,
            JSON.stringify(response, null, 2),
          );
          console.log(`ðŸ“¥ API: Response type:`, typeof response);
          console.log(`ðŸ“¥ API: Response is null:`, response === null);

          // Check HTTP status from meta
          const status = meta?.response?.status;
          console.log(`ðŸ“¥ API: HTTP Status Code:`, status);

          if (status === 200) {
            console.log(`âœ… PUT Request SUCCEEDED (200 OK)`);
          } else if (status === 204) {
            console.log(
              `âœ… PUT Request SUCCEEDED (204 No Content - normal for PUT)`,
            );
          } else if (status >= 400) {
            console.error(`âŒ PUT Request FAILED with status:`, status);
          } else {
            console.log(`âš ï¸ PUT Request status:`, status);
          }

          console.log(`ðŸ“¥ API: Response Headers:`, meta?.response?.headers);
          console.log(`ðŸ“¥ API: Full Meta:`, JSON.stringify(meta, null, 2));
        }

        // Backend returns full document with arrays: { gold: [{date, price}, ...], silver: [...], platinum: [...] }
        // Process it the same way as GET endpoint to extract latest prices
        if (
          response &&
          typeof response === 'object' &&
          (response.gold || response.silver || response.platinum)
        ) {
          const processedResponse = {};
          const metals = ['gold', 'silver', 'platinum'];

          metals.forEach(metalKey => {
            const metalArray = response[metalKey];
            if (Array.isArray(metalArray) && metalArray.length > 0) {
              // Sort by date (newest first) and get the latest entry
              const sortedByDate = [...metalArray].sort((a, b) => {
                const dateA = new Date(a.date || a.Date || 0);
                const dateB = new Date(b.date || b.Date || 0);
                return dateB - dateA; // Descending order (latest first)
              });
              const latestEntry = sortedByDate[0];

              processedResponse[metalKey] = {
                price: latestEntry.price || latestEntry.Price || 0,
                unit: 'per gram',
                lastUpdated:
                  latestEntry.date ||
                  latestEntry.Date ||
                  new Date().toISOString(),
              };

              if (__DEV__) {
                console.log(
                  `ðŸ’° Processed ${metalKey}:`,
                  processedResponse[metalKey],
                );
              }
            }
          });

          if (__DEV__) {
            console.log(
              `ðŸ“Š Processed Response:`,
              JSON.stringify(processedResponse, null, 2),
            );
          }

          // Return the full response so frontend can access all metals
          return response;
        }

        return response;
      },
      invalidatesTags: ['MetalPrice'],
    }),

    deleteMetalPrice: builder.mutation({
      query: ({ metal, date }) => ({
        url: `/api/metal-prices/${metal}`,
        method: 'DELETE',
        body: {
          date: date || new Date().toISOString().split('T')[0],
        },
      }),
      invalidatesTags: ['MetalPrice'],
    }),

    // Get full metal price history (all entries, not just latest)
    getMetalPriceHistory: builder.query({
      query: (useCache = false) => {
        const cacheBuster = useCache ? '' : `?t=${Date.now()}`;
        return `/api/metal-prices${cacheBuster}`;
      },
      providesTags: ['MetalPrice'],
      transformResponse: data => {
        // Backend returns: { gold: [{date, price}, ...], silver: [...], platinum: [...] }
        if (data && typeof data === 'object') {
          const history = {};
          const metals = ['gold', 'silver', 'platinum'];

          metals.forEach(metal => {
            const metalData = data[metal];
            if (Array.isArray(metalData) && metalData.length > 0) {
              // Sort by date (oldest first)
              history[metal] = [...metalData]
                .sort((a, b) => {
                  const dateA = new Date(a.date || a.Date || 0);
                  const dateB = new Date(b.date || b.Date || 0);
                  return dateA - dateB;
                })
                .map(item => ({
                  date: item.date || item.Date,
                  price: item.price || item.Price || 0,
                }));
            } else {
              history[metal] = [];
            }
          });

          return history;
        }

        return { gold: [], silver: [], platinum: [] };
      },
    }),
    //============= Jwellery Estimation =============
    JwelleryPriceData: builder.mutation({
      query: ({
        imageFrontView,
        imageSideView,
        image45view,
        additionalImages,
        clientId,
        description,
      }) => {
        const formData = new FormData();

        formData.append('clientId', clientId);
        if (description) {
          formData.append('description', description);
        }

        const appendImage = (fieldName, imgData) => {
          if (imgData && imgData.uri) {
            formData.append(fieldName, {
              uri: imgData.uri,
              type: imgData.type || 'image/jpeg',
              name: imgData.name || `${fieldName}_${Date.now()}.jpg`,
            });
          } else if (imgData) {
            formData.append(fieldName, imgData);
          }
        };

        // 1. Required Top View
        appendImage('topView', imageFrontView);

        // 2. Optional Side View
        if (imageSideView) {
          appendImage('sideView', imageSideView);
        }

        // 3. Optional 45 Degree View (Fixed field name)
        if (image45view) {
          appendImage('fortyFiveView', image45view);
        }

        // 4. Optional Additional Images (Fixed field name)
        if (additionalImages && Array.isArray(additionalImages)) {
          additionalImages.forEach(img => {
            appendImage('additional', img);
          });
        } else if (additionalImages) {
          appendImage('additional', additionalImages);
        }

        return {
          url: '/api/jewelry-estimate',
          method: 'POST',
          body: formData,
        };
      },

      transformResponse: response => {
        if (__DEV__) {
          console.log(
            '✅ [JwelleryPriceData] Response:',
            JSON.stringify(response, null, 2),
          );
        }
        return response;
      },

      transformErrorResponse: response => {
        if (__DEV__) {
          console.error(
            '❌ [JwelleryPriceData] Error:',
            JSON.stringify(response, null, 2),
          );

          if (response.data) {
            if (typeof response.data === 'string') {
              console.error('Error message (string):', response.data);
            } else if (typeof response.data === 'object') {
              console.error('Error object keys:', Object.keys(response.data));
            }
          }
        }

        let errorMessage =
          response.data?.message ||
          response.data?.error ||
          `Pricing calculation failed (${response.status || 'Unknown error'})`;

        if (
          response.status === 500 &&
          (!response.data?.message ||
            response.data?.message === 'Internal server error')
        ) {
          errorMessage =
            'Internal server error: Check backend configuration or file sizes.';
        }

        return {
          status: response.status,
          data: response.data,
          error: errorMessage,
        };
      },
    }),
    //============= image pricing extraction ===========
    ImagepriceData: builder.mutation({
      query: ({ image, clientId, stoneType, quantity, metalQuality }) => {
        // Create FormData
        const formData = new FormData();

        // Required fields
        formData.append('image', image);
        formData.append('clientId', clientId);

        // Optional fields
        if (stoneType) {
          formData.append('stoneType', stoneType);
        }

        if (quantity) {
          formData.append('quantity', quantity);
        }

        if (metalQuality) {
          formData.append('metalQuality', metalQuality);
        }

        // Dev Logs
        if (__DEV__) {
          console.log('ðŸ“¤ Image Pricing Payload:', {
            image: image?.name || image?.fileName || image,
            clientId,
            stoneType,
            quantity,
            metalQuality,
          });
        }

        return {
          url: '/api/image-pricing',
          method: 'POST',
          body: formData,
        };
      },
      transformResponse: response => {
        if (__DEV__) {
          console.log(
            'âœ… [calculatePricing] Response:',
            JSON.stringify(response, null, 2),
          );
        }
        return response;
      },
      transformErrorResponse: response => {
        if (__DEV__) {
          console.error(
            'âŒ [calculatePricing] Error:',
            JSON.stringify(response, null, 2),
          );

          if (response.data) {
            if (typeof response.data === 'string') {
              console.error('Error message (string):', response.data);
            } else if (typeof response.data === 'object') {
              console.error('Error object keys:', Object.keys(response.data));
            }
          }

          if (response.status === 500) {
            console.error('Server error - likely client configuration issue');
          }
        }

        let errorMessage =
          response.data?.message ||
          response.data?.error ||
          `Pricing calculation failed (${response.status || 'Unknown error'})`;

        if (
          response.status === 500 &&
          (!response.data?.message ||
            response.data?.message === 'Internal server error')
        ) {
          errorMessage =
            'Internal server error: Client configuration issue. The client may not exist or may be missing pricing configuration.';
        }

        return {
          status: response.status,
          data: response.data,
          error: errorMessage,
        };
      },
    }),
    calculatePricing: builder.mutation({
      query: ({ details, clientId, isRecalculate = false }) => {
        if (__DEV__) {
          console.log(
            'ðŸ’° [calculatePricing] Payload:',
            JSON.stringify({ details, clientId, isRecalculate }, null, 2),
          );
        }
        return {
          url: '/api/enquiries/pricingCalculate',
          method: 'POST',
          body: { details, clientId, isRecalculate },
        };
      },
      transformResponse: response => {
        if (__DEV__) {
          console.log(
            'âœ… [calculatePricing] Response:',
            JSON.stringify(response, null, 2),
          );
        }
        return response;
      },
      transformErrorResponse: response => {
        if (__DEV__) {
          console.error(
            'âŒ [calculatePricing] Error:',
            JSON.stringify(response, null, 2),
          );

          if (response.data) {
            if (typeof response.data === 'string') {
              console.error('Error message (string):', response.data);
            } else if (typeof response.data === 'object') {
              console.error('Error object keys:', Object.keys(response.data));
            }
          }

          if (response.status === 500) {
            console.error('Server error - likely client configuration issue');
          }
        }

        let errorMessage =
          response.data?.message ||
          response.data?.error ||
          `Pricing calculation failed (${response.status || 'Unknown error'})`;

        if (
          response.status === 500 &&
          (!response.data?.message ||
            response.data?.message === 'Internal server error')
        ) {
          errorMessage =
            'Internal server error: Client configuration issue. The client may not exist or may be missing pricing configuration.';
        }

        return {
          status: response.status,
          data: response.data,
          error: errorMessage,
        };
      },
    }),

    // Get chat by enquiry ID with type
    getChatByEnquiry: builder.query({
      query: ({ enquiryId, type }) => {
        if (!enquiryId) {
          throw new Error('enquiryId is required');
        }
        // Determine type based on user role if not provided
        const chatType = type || 'admin-client';
        return `/api/chats/enquiry/${enquiryId}?type=${chatType}`;
      },
      providesTags: (result, error, { enquiryId }) => [
        { type: 'Chat', id: enquiryId },
      ],
    }),

    // Get all chats for an enquiry (both admin-client and admin-designer)
    // Uses /api/chats with search parameter and filters client-side
    // Renamed from getChatsByEnquiry to getChatsByEnquiryV2 to bypass old cached queries
    getChatsByEnquiryV2: builder.query({
      query: ({ enquiryId }) => {
        if (!enquiryId) {
          throw new Error('enquiryId is required');
        }
        // Use /api/chats with search parameter (searches by enquiry name or ID)
        // Fetch with high limit to get all chats, then filter client-side
        const enquiryIdStr = String(enquiryId).trim();
        const params = new URLSearchParams();
        params.append('search', enquiryIdStr);
        params.append('limit', '100'); // High limit to get all matching chats
        params.append('page', '1');
        const url = `/api/chats?${params.toString()}`;
        if (__DEV__) {
          console.log('âœ…âœ…âœ… getChatsByEnquiryV2 (NEW CODE) âœ…âœ…âœ…');
        }
        return url;
      },
      providesTags: (result, error, { enquiryId }) => [
        { type: 'Chat', id: enquiryId },
      ],
      transformResponse: (data, meta, arg) => {
        try {
          const { enquiryId } = arg;
          const enquiryIdStr = String(enquiryId).trim();

          // Handle different response formats
          if (!data) {
            return [];
          }

          let chatsArray = [];
          if (Array.isArray(data)) {
            chatsArray = data;
          } else if (data.Data && Array.isArray(data.Data)) {
            chatsArray = data.Data;
          } else if (data.data && Array.isArray(data.data)) {
            chatsArray = data.data;
          } else if (data.chats && Array.isArray(data.chats)) {
            chatsArray = data.chats;
          } else {
            return [];
          }

          // Normalize chat objects and filter by enquiryId
          const normalizedChats = chatsArray
            .map((chat, index) => {
              try {
                // Handle MongoDB ObjectId format
                let chatId = chat._id;
                if (chatId?.$oid) {
                  chatId = chatId.$oid;
                } else if (chatId?._id) {
                  chatId = chatId._id;
                } else {
                  chatId = chatId || chat.id;
                }

                let enquiryId = chat.EnquiryId || chat.enquiryId;
                if (enquiryId?.$oid) {
                  enquiryId = enquiryId.$oid;
                } else if (enquiryId?._id) {
                  enquiryId = enquiryId._id;
                }

                // Handle last message
                let lastMessage = '';
                let lastMessageTime = null;
                if (chat.LastMessage) {
                  if (typeof chat.LastMessage === 'object') {
                    lastMessage =
                      chat.LastMessage.Message ||
                      chat.LastMessage.message ||
                      chat.LastMessage.text ||
                      '';
                    lastMessageTime =
                      chat.LastMessage.Timestamp ||
                      chat.LastMessage.timestamp ||
                      chat.LastMessage.updatedAt;
                  } else {
                    lastMessage = chat.LastMessage;
                  }
                } else if (chat.lastMessage) {
                  lastMessage = chat.lastMessage;
                }

                if (lastMessageTime?.$date) {
                  lastMessageTime = lastMessageTime.$date;
                }

                return {
                  _id: chatId,
                  id: chatId,
                  _originalData: chat,
                  EnquiryId: enquiryId,
                  enquiryId: enquiryId,
                  EnquiryName:
                    chat.EnquiryName ||
                    chat.enquiryTitle ||
                    chat.EnquiryTitle ||
                    'Untitled Chat',
                  enquiryTitle:
                    chat.EnquiryName ||
                    chat.enquiryTitle ||
                    chat.EnquiryTitle ||
                    'Untitled Chat',
                  Type: chat.Type || chat.type,
                  type: chat.Type || chat.type,
                  LastMessage: chat.LastMessage,
                  lastMessage: lastMessage,
                  lastMessageTime: lastMessageTime,
                  UnreadCount: chat.UnreadCount || chat.unreadCount || 0,
                  unreadCount: chat.UnreadCount || chat.unreadCount || 0,
                  IsGroup: chat.IsGroup || chat.isGroup || false,
                  isGroup: chat.IsGroup || chat.isGroup || false,
                };
              } catch (chatError) {
                // Return a minimal valid chat object
                return {
                  _id: chat?._id || chat?.id || `error-${index}`,
                  id: chat?._id || chat?.id || `error-${index}`,
                  _originalData: chat,
                  EnquiryId: chat?.EnquiryId || chat?.enquiryId || null,
                  enquiryId: chat?.EnquiryId || chat?.enquiryId || null,
                  EnquiryName: 'Error loading chat',
                  enquiryTitle: 'Error loading chat',
                  Type: chat?.Type || chat?.type || null,
                  type: chat?.Type || chat?.type || null,
                  LastMessage: null,
                  lastMessage: 'Error loading message',
                  lastMessageTime: null,
                  UnreadCount: 0,
                  unreadCount: 0,
                  IsGroup: false,
                  isGroup: false,
                };
              }
            })
            .filter(chat => chat && (chat._id || chat.id)); // Filter out any null/undefined chats

          // Filter to only include chats matching the enquiryId
          const filteredChats = normalizedChats.filter(chat => {
            const chatEnquiryId = String(
              chat.enquiryId || chat.EnquiryId || '',
            ).trim();
            return chatEnquiryId === enquiryIdStr;
          });

          return filteredChats;
        } catch (error) {
          return [];
        }
      },
      transformErrorResponse: (response, meta, arg) => {
        if (__DEV__) {
          const { enquiryId } = arg || {};
          console.error('âŒ getChatsByEnquiryV2 API Error:', {
            enquiryId,
            status: response.status,
            originalStatus: response.originalStatus,
            data: response.data,
            message:
              response.data?.message || response.data?.error || 'Unknown error',
            url: meta?.request?.url || meta?.request?.endpoint || 'unknown',
            endpointName: 'getChatsByEnquiryV2',
          });
          // Check if error is from old endpoint
          if (
            response.data &&
            typeof response.data === 'string' &&
            response.data.includes('/api/chats/enquiry/')
          ) {
          }
        }
        return {
          status: response.status,
          data: response.data,
          error:
            response.data?.message ||
            response.data?.error ||
            'Failed to load chats',
        };
      },
    }),

    // Get all chats (for chat list)
    getChats: builder.query({
      query: ({ page = 1, limit = 10, search = '', type } = {}) => {
        const params = new URLSearchParams();
        params.append('page', page.toString());
        params.append('limit', limit.toString());
        if (search) {
          params.append('search', search);
        }
        // Add type parameter if provided (admin-client or admin-designer)
        if (type) {
          params.append('type', type);
        }
        return `/api/chats?${params.toString()}`;
      },
      providesTags: ['Chat'],
      keepUnusedDataFor: 300, // Keep cache 5 min so list uses cached data until manual refresh
      transformResponse: (data, meta, arg) => {
        if (__DEV__) {
          console.log('getChats API Response (raw):', data);
          console.log(
            'Response type:',
            Array.isArray(data) ? 'Array' : typeof data,
          );
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            console.log('Response structure:', {
              hasData: !!data.Data,
              dataIsArray: Array.isArray(data.Data),
              hasChats: !!data.chats,
              chatsIsArray: Array.isArray(data.chats),
              hasDataLower: !!data.data,
              dataLowerIsArray: Array.isArray(data.data),
            });
          }
        }

        // Handle different response formats
        // According to the guide, response format is: { Total, page, limit, TotalPages, Data }
        let chatsArray = [];
        if (Array.isArray(data)) {
          // Check if this is an array of messages (need to aggregate) or chats
          if (data.length > 0 && data[0].message && data[0].enquiryId) {
            // This looks like messages - aggregate into chats by enquiryId

            const chatMap = new Map();

            data.forEach(msg => {
              // Extract enquiryId
              let enquiryId =
                msg.enquiryId?.$oid || msg.enquiryId || msg.EnquiryId;
              if (!enquiryId) return;

              // Extract timestamp
              let timestamp =
                msg.timestamp?.$date || msg.timestamp || msg.Timestamp;

              // Get or create chat
              if (!chatMap.has(enquiryId)) {
                chatMap.set(enquiryId, {
                  _id: enquiryId,
                  enquiryId: enquiryId,
                  enquiryTitle:
                    msg.EnquiryName ||
                    msg.enquiryName ||
                    msg.enquiryTitle ||
                    msg.EnquiryTitle ||
                    msg.Enquiry?.Name ||
                    msg.Enquiry?.title ||
                    'Untitled Chat',
                  clientName: msg.clientName || 'Unknown Client',
                  lastMessage: '',
                  lastMessageTime: timestamp || new Date().toISOString(),
                  unreadCount: 0,
                  messages: [],
                });
              }

              const chat = chatMap.get(enquiryId);
              chat.messages.push(msg);

              // Update last message if this is newer
              const msgTime = timestamp ? new Date(timestamp) : new Date(0);
              const chatTime = chat.lastMessageTime
                ? new Date(chat.lastMessageTime)
                : new Date(0);

              if (msgTime > chatTime) {
                chat.lastMessage = msg.message || msg.text || '';
                chat.lastMessageTime = timestamp || new Date().toISOString();
              }
            });

            // Convert map to array
            chatsArray = Array.from(chatMap.values());
          } else {
            // This looks like chats array
            chatsArray = data;
          }
        } else if (data && typeof data === 'object') {
          // Handle paginated response format from guide: { Total, page, limit, TotalPages, Data }
          if (data.Data && Array.isArray(data.Data)) {
            chatsArray = data.Data;
            // Store pagination metadata in meta for access
            if (meta) {
              meta.pagination = {
                total: data.Total || data.total || 0,
                page: data.page || data.Page || arg.page || 1,
                limit: data.limit || data.Limit || arg.limit || 10,
                totalPages: data.TotalPages || data.totalPages || 1,
              };
            }
          } else if (data.chats && Array.isArray(data.chats)) {
            chatsArray = data.chats;
            if (meta) {
              meta.pagination = {
                total: data.Total || data.total || 0,
                page: data.page || data.Page || arg.page || 1,
                limit: data.limit || data.Limit || arg.limit || 10,
                totalPages: data.TotalPages || data.totalPages || 1,
              };
            }
          } else if (data.data && Array.isArray(data.data)) {
            chatsArray = data.data;
            if (meta) {
              meta.pagination = {
                total: data.Total || data.total || 0,
                page: data.page || data.Page || arg.page || 1,
                limit: data.limit || data.Limit || arg.limit || 10,
                totalPages: data.TotalPages || data.totalPages || 1,
              };
            }
          } else {
            return [];
          }
        } else {
          return [];
        }

        const normalizedChats = chatsArray.map(chat => {
          // Handle MongoDB ObjectId format for enquiryId
          let enquiryId = chat.EnquiryId || chat.enquiryId;
          if (enquiryId?.$oid) {
            enquiryId = enquiryId.$oid;
          } else if (enquiryId?._id) {
            enquiryId = enquiryId._id;
          }

          // Handle MongoDB ObjectId format for chat ID
          let chatId = chat._id;
          if (chatId?.$oid) {
            chatId = chatId.$oid;
          } else if (chatId?._id) {
            chatId = chatId._id;
          } else {
            chatId = chatId || chat.id;
          }

          // Handle timestamp
          let lastMessageTime =
            chat.LastMessageTime ||
            chat.lastMessageTime ||
            chat.updatedAt ||
            chat.UpdatedAt;
          if (lastMessageTime?.$date) {
            lastMessageTime = lastMessageTime.$date;
          } else if (lastMessageTime?.Timestamp) {
            lastMessageTime = lastMessageTime.Timestamp;
          }

          // Handle LastMessage - it can be an object or a string
          let lastMessageText = '';
          let lastMessageSenderName = '';
          let lastMessageSenderId = '';
          const lastMessageObj = chat.LastMessage || chat.lastMessage;
          if (lastMessageObj) {
            if (typeof lastMessageObj === 'string') {
              lastMessageText = lastMessageObj;
            } else if (typeof lastMessageObj === 'object') {
              // Extract text from message object
              lastMessageText =
                lastMessageObj.Message ||
                lastMessageObj.message ||
                lastMessageObj.text ||
                lastMessageObj.Text ||
                '';
              // Backend sends Sender as object { _id: ..., name: ... } or as string, or SenderName as string
              if (
                lastMessageObj.Sender &&
                typeof lastMessageObj.Sender === 'object'
              ) {
                lastMessageSenderName =
                  lastMessageObj.Sender.name ||
                  lastMessageObj.Sender.Name ||
                  '';
                lastMessageSenderId =
                  lastMessageObj.Sender._id ||
                  lastMessageObj.Sender.Id ||
                  lastMessageObj.Sender.id ||
                  '';
                if (__DEV__ && !lastMessageSenderName && lastMessageSenderId) {
                  console.log(
                    '[API] LastMessage.Sender object has _id but no name:',
                    {
                      senderObj: lastMessageObj.Sender,
                      senderId: lastMessageSenderId,
                    },
                  );
                }
              } else if (typeof lastMessageObj.Sender === 'string') {
                // Backend sends Sender as string (the name)
                lastMessageSenderName = lastMessageObj.Sender;
              } else {
                // Try SenderName field (backend might send this separately)
                lastMessageSenderName =
                  lastMessageObj.SenderName ||
                  lastMessageObj.senderName ||
                  lastMessageObj.sender ||
                  '';
              }
              // Also check for SenderId at LastMessage level (backend sends this separately)
              lastMessageSenderId =
                lastMessageSenderId ||
                lastMessageObj.SenderId ||
                lastMessageObj.senderId ||
                '';

              if (__DEV__) {
                if (lastMessageSenderName) {
                } else if (lastMessageSenderId) {
                  // console.log('[API] âŒ Have SenderId but no name from LastMessage:', {
                  //   senderId: lastMessageSenderId,
                  //   hasSender: !!lastMessageObj.Sender,
                  //   senderType: typeof lastMessageObj.Sender,
                  //   senderValue: lastMessageObj.Sender,
                  //   hasSenderName: !!lastMessageObj.SenderName,
                  //   senderNameValue: lastMessageObj.SenderName,
                  //   lastMessageKeys: Object.keys(lastMessageObj),
                  // });
                }
              }
            }
          } else {
            lastMessageText = chat.message || '';
          }

          // Handle LastSender - it can be an object or a string
          // Priority 1: Use extracted name from LastMessage (most reliable)
          let lastSenderName = lastMessageSenderName || '';
          let lastSenderId =
            chat.LastSenderId || chat.lastSenderId || lastMessageSenderId;
          const lastSenderObj = chat.LastSender || chat.lastSender;
          if (lastSenderObj && !lastSenderName) {
            if (typeof lastSenderObj === 'string') {
              lastSenderName = lastSenderObj;
            } else if (typeof lastSenderObj === 'object') {
              lastSenderId =
                lastSenderId ||
                lastSenderObj.Id ||
                lastSenderObj._id ||
                lastSenderObj.id ||
                lastSenderObj.SenderId ||
                lastSenderObj.senderId;
              lastSenderName =
                lastSenderObj.Name ||
                lastSenderObj.name ||
                lastSenderObj.SenderName ||
                lastSenderObj.senderName ||
                '';
            }
          } else if (!lastSenderName) {
            lastSenderName = chat.sender || '';
          }
          // Fallback to lastMessage sender if available
          if (
            !lastSenderId &&
            lastMessageObj &&
            typeof lastMessageObj === 'object'
          ) {
            // Try SenderId field first
            lastSenderId = lastMessageObj.SenderId || lastMessageObj.senderId;
            // If Sender is an object, extract _id from it
            if (
              !lastSenderId &&
              lastMessageObj.Sender &&
              typeof lastMessageObj.Sender === 'object'
            ) {
              lastSenderId =
                lastMessageObj.Sender._id ||
                lastMessageObj.Sender.Id ||
                lastMessageObj.Sender.id ||
                '';
            }
            // Try to get name from Sender object or SenderName field
            if (!lastSenderName) {
              if (
                lastMessageObj.Sender &&
                typeof lastMessageObj.Sender === 'object'
              ) {
                lastSenderName =
                  lastMessageObj.Sender.Name ||
                  lastMessageObj.Sender.name ||
                  '';
              } else if (typeof lastMessageObj.Sender === 'string') {
                lastSenderName = lastMessageObj.Sender;
              } else {
                lastSenderName =
                  lastMessageObj.SenderName || lastMessageObj.senderName || '';
              }
            }
          } else if (
            !lastSenderName &&
            lastMessageObj &&
            typeof lastMessageObj === 'object'
          ) {
            if (
              lastMessageObj.Sender &&
              typeof lastMessageObj.Sender === 'object'
            ) {
              lastSenderName =
                lastMessageObj.Sender.Name || lastMessageObj.Sender.name || '';
            } else if (typeof lastMessageObj.Sender === 'string') {
              lastSenderName = lastMessageObj.Sender;
            } else {
              lastSenderName =
                lastMessageObj.SenderName || lastMessageObj.senderName || '';
            }
          }
          // lastMessageSenderName is already prioritized above, so no need to check again here
          // Fallback: derive sender name from participants by ID
          if (
            !lastSenderName &&
            lastSenderId &&
            Array.isArray(chat.Participants || chat.participants)
          ) {
            const participantsArray =
              chat.Participants || chat.participants || [];
            const found = participantsArray.find(p => {
              const pid = p._id || p.id || p.Id;
              return pid && String(pid) === String(lastSenderId);
            });
            if (found) {
              lastSenderName = found.Name || found.name || '';
            }
          }

          // Extract unread count from multiple possible field names
          // Backend may send: UnreadCount, unreadCount, Unread, unread, UnreadMessages, unreadMessages, etc.
          // Also check nested objects like Unread.Count, Metadata.unreadCount, etc.
          let unreadCount = 0;
          let unreadCountSource = 'none';

          // Direct fields (most common)
          if (chat.UnreadCount !== undefined && chat.UnreadCount !== null) {
            unreadCount = Number(chat.UnreadCount) || 0;
            unreadCountSource = 'UnreadCount';
          } else if (
            chat.unreadCount !== undefined &&
            chat.unreadCount !== null
          ) {
            unreadCount = Number(chat.unreadCount) || 0;
            unreadCountSource = 'unreadCount';
          } else if (chat.Unread !== undefined && chat.Unread !== null) {
            unreadCount = Number(chat.Unread) || 0;
            unreadCountSource = 'Unread';
          } else if (chat.unread !== undefined && chat.unread !== null) {
            unreadCount = Number(chat.unread) || 0;
            unreadCountSource = 'unread';
          } else if (
            chat.UnreadMessages !== undefined &&
            chat.UnreadMessages !== null
          ) {
            unreadCount = Number(chat.UnreadMessages) || 0;
            unreadCountSource = 'UnreadMessages';
          } else if (
            chat.unreadMessages !== undefined &&
            chat.unreadMessages !== null
          ) {
            unreadCount = Number(chat.unreadMessages) || 0;
            unreadCountSource = 'unreadMessages';
          } else if (
            chat.UnreadMessageCount !== undefined &&
            chat.UnreadMessageCount !== null
          ) {
            unreadCount = Number(chat.UnreadMessageCount) || 0;
            unreadCountSource = 'UnreadMessageCount';
          } else if (
            chat.unreadMessageCount !== undefined &&
            chat.unreadMessageCount !== null
          ) {
            unreadCount = Number(chat.unreadMessageCount) || 0;
            unreadCountSource = 'unreadMessageCount';
          }
          // Check nested objects
          else if (
            chat.Unread &&
            typeof chat.Unread === 'object' &&
            chat.Unread.Count !== undefined
          ) {
            unreadCount = Number(chat.Unread.Count) || 0;
            unreadCountSource = 'Unread.Count';
          } else if (
            chat.unread &&
            typeof chat.unread === 'object' &&
            chat.unread.count !== undefined
          ) {
            unreadCount = Number(chat.unread.count) || 0;
            unreadCountSource = 'unread.count';
          } else if (
            chat.Metadata &&
            typeof chat.Metadata === 'object' &&
            chat.Metadata.unreadCount !== undefined
          ) {
            unreadCount = Number(chat.Metadata.unreadCount) || 0;
            unreadCountSource = 'Metadata.unreadCount';
          } else if (
            chat.metadata &&
            typeof chat.metadata === 'object' &&
            chat.metadata.unreadCount !== undefined
          ) {
            unreadCount = Number(chat.metadata.unreadCount) || 0;
            unreadCountSource = 'metadata.unreadCount';
          } else if (
            chat.Stats &&
            typeof chat.Stats === 'object' &&
            chat.Stats.UnreadCount !== undefined
          ) {
            unreadCount = Number(chat.Stats.UnreadCount) || 0;
            unreadCountSource = 'Stats.UnreadCount';
          } else if (
            chat.stats &&
            typeof chat.stats === 'object' &&
            chat.stats.unreadCount !== undefined
          ) {
            unreadCount = Number(chat.stats.unreadCount) || 0;
            unreadCountSource = 'stats.unreadCount';
          }

          // Debug logging for unread count - log always to help diagnose missing counts

          // If unread count is still 0, try to calculate from LastMessage ReadBy
          // This is a fallback if backend doesn't send unread count directly
          if (
            unreadCount === 0 &&
            lastMessageObj &&
            typeof lastMessageObj === 'object'
          ) {
            const lastMessageSenderId =
              lastMessageObj.SenderId || lastMessageObj.senderId;
            const lastMessageIsRead =
              lastMessageObj.IsRead || lastMessageObj.isRead || false;
            const lastMessageReadBy =
              lastMessageObj.ReadBy || lastMessageObj.readBy || [];

            // If last message is not from current user and not read, count as 1 unread
            // Note: This is a simplified calculation - backend should provide accurate count
            // We can't calculate full unread count without fetching all messages
            if (
              lastMessageSenderId &&
              !lastMessageIsRead &&
              Array.isArray(lastMessageReadBy)
            ) {
              // Check if current user has read it (would need user context, but we'll use a heuristic)
              // For now, if IsRead is false, assume it's unread
              // This is a fallback - backend should provide UnreadCount
              if (__DEV__) {
                console.log(
                  '[API] ðŸ”„ Attempting to infer unread from LastMessage:',
                  {
                    chatId: chatId,
                    lastMessageIsRead,
                    lastMessageReadByLength: lastMessageReadBy.length,
                    note: 'Backend should provide UnreadCount field',
                  },
                );
              }
            }
          }

          return {
            id: chatId,
            enquiryId: enquiryId || chat.Enquiry?.id || chat.enquiry?.id,
            enquiryTitle:
              chat.EnquiryName ||
              chat.enquiryName ||
              chat.EnquiryTitle ||
              chat.enquiryTitle ||
              chat.Enquiry?.Name ||
              chat.Enquiry?.title ||
              'Untitled Chat',
            clientName:
              chat.ClientName ||
              chat.clientName ||
              chat.Client?.Name ||
              chat.client?.name ||
              '',
            lastMessage: lastMessageText,
            lastMessageTime: lastMessageTime || new Date().toISOString(),
            unreadCount: unreadCount, // CRITICAL: Always set unreadCount (even if 0)
            _originalData: chat, // CRITICAL: Preserve original data for fallback
            isGroup: chat.IsGroup || chat.isGroup || false,
            participants: chat.Participants || chat.participants || [],
            lastSender: lastSenderName,
            lastSenderId: lastSenderId,
            lastMessageSenderName: lastMessageSenderName,
            lastMessageSenderId: lastMessageSenderId,
            status: chat.Status || chat.status || 'active',
            isClient: chat.IsClient || chat.isClient || false,
            // Preserve chat type for filtering (important for role-based chat visibility)
            type: chat.Type || chat.type || null,
            Type: chat.Type || chat.type || null,
          };
        });

        return normalizedChats;
      },
    }),

    getChatMessages: builder.query({
      queryFn: async (
        { chatId, before, limit = 20 } = {},
        { getState },
        extraOptions,
        baseQuery,
      ) => {
        if (!chatId) {
          return {
            error: { status: 'CUSTOM_ERROR', data: 'chatId is required' },
          };
        }

        try {
          const token = await secureStorage.getItem('token');
          const params = new URLSearchParams();
          params.append('limit', limit.toString());
          if (before) {
            params.append('before', before);
          }

          const url = `/api/message/${chatId}/messages?${params.toString()}`;

          const response = await fetch(`${API_BASE_URL}${url}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          // Get response as text first to check if it's HTML
          const responseText = await response.text();

          // Check if response is HTML (404 page or error page)
          if (
            responseText.includes('<!DOCTYPE') ||
            responseText.includes('<html') ||
            responseText.includes('Cannot GET')
          ) {
            // Backend endpoint /api/message/:chatId/messages doesn't exist yet
            // This is expected - messages work via WebSocket, historical messages will be empty
            // Only log once per chat to reduce noise
            if (__DEV__ && !global._loggedMissingMessagesEndpoint) {
              global._loggedMissingMessagesEndpoint = true;
            }
            // Return empty array - messages will be empty but app won't crash
            // WebSocket messages will still work fine
            return { data: [] };
          }

          // Try to parse as JSON
          let data;
          try {
            data = JSON.parse(responseText);
          } catch (parseError) {
            if (__DEV__) {
              console.error('Response text:', responseText.substring(0, 500));
            }
            // Return empty array if JSON parsing fails
            return { data: [] };
          }

          // Log the raw response for debugging
          if (__DEV__) {
            console.log('ðŸ“¥ Raw API Response:', {
              hasData: !!data,
              dataKeys: data ? Object.keys(data) : [],
              isArray: Array.isArray(data),
              dataType: typeof data,
              sample: data ? JSON.stringify(data).substring(0, 200) : null,
            });
          }

          // Handle different response formats
          let messagesArray = [];
          let nextCursor = null;

          // Check for various response formats
          if (data && data.Data && Array.isArray(data.Data)) {
            // Format: { Data: [...], NextCursor: "..." }
            messagesArray = data.Data;
            nextCursor = data.NextCursor || data.nextCursor || null;
            if (__DEV__) {
              console.log('âœ… Using format: data.Data (capital D)');
            }
          } else if (data && data.data && Array.isArray(data.data)) {
            // Format: { data: [...], nextCursor: "..." }
            messagesArray = data.data;
            nextCursor = data.nextCursor || data.NextCursor || null;
            if (__DEV__) {
              console.log('âœ… Using format: data.data (lowercase d)');
            }
          } else if (data && data.messages && Array.isArray(data.messages)) {
            // Format: { messages: [...], nextCursor: "..." }
            messagesArray = data.messages;
            nextCursor = data.nextCursor || data.NextCursor || null;
          } else if (Array.isArray(data)) {
            // Format: direct array [...]
            messagesArray = data;
          } else if (data && data.result && Array.isArray(data.result)) {
            // Format: { result: [...] }
            messagesArray = data.result;
            nextCursor = data.nextCursor || data.NextCursor || null;
          } else {
            if (__DEV__) {
              console.warn('Response structure:', {
                type: typeof data,
                isArray: Array.isArray(data),
                keys: data ? Object.keys(data) : [],
                sample: data ? JSON.stringify(data).substring(0, 300) : null,
              });
            }
            messagesArray = [];
          }

          if (__DEV__) {
            if (messagesArray.length > 0) {
            }
          }

          // Transform messages to consistent format
          const transformedMessages = messagesArray
            .map((message, index) => {
              // Handle MongoDB ObjectId format
              const messageId = message._id?.$oid || message._id || message.id;
              const senderId =
                message.senderId?.$oid || message.senderId || message.SenderId;

              // Handle timestamp format (MongoDB $date or ISO string)
              let timestamp = message.timestamp;
              if (timestamp?.$date) {
                timestamp = timestamp.$date;
              } else if (timestamp?.Timestamp) {
                timestamp = timestamp.Timestamp;
              } else if (typeof timestamp === 'string') {
                timestamp = timestamp;
              } else {
                timestamp = new Date().toISOString();
              }

              // Handle message type and content
              const messageType =
                message.messageType ||
                message.MessageType ||
                message.type ||
                'text';
              let text =
                message.message || message.Message || message.text || '';
              let mediaKey = message.mediaKey || message.mediaUrl || '';
              let mediaName = message.mediaName || message.filename || '';

              // For image/file messages, set appropriate text
              if (messageType === 'image' && !text) {
                text = 'ðŸ“· Image';
              } else if (messageType === 'file' && !text) {
                text = mediaName || 'ðŸ“Ž File';
              }

              return {
                _id: messageId || `msg-${index}`,
                id: messageId || `msg-${index}`,
                Message: text,
                message: text,
                text: text,
                SenderId: senderId,
                senderId: senderId,
                SenderName:
                  message.senderName ||
                  message.SenderName ||
                  message.sender?.name ||
                  'Unknown',
                senderName:
                  message.senderName ||
                  message.SenderName ||
                  message.sender?.name ||
                  'Unknown',
                SenderRole:
                  message.senderRole ||
                  message.SenderRole ||
                  message.sender?.role ||
                  'user',
                senderRole:
                  message.senderRole ||
                  message.SenderRole ||
                  message.sender?.role ||
                  'user',
                Timestamp: timestamp,
                timestamp: timestamp,
                MessageType: messageType,
                messageType: messageType,
                Media:
                  message.Media ||
                  (message.mediaUrl
                    ? { Url: message.mediaUrl, Size: message.mediaSize }
                    : null),
                media:
                  message.Media ||
                  (message.mediaUrl
                    ? { url: message.mediaUrl, size: message.mediaSize }
                    : null),
                mediaUrl:
                  message.Media?.Url || message.media?.url || message.mediaUrl,
                mediaSize:
                  message.Media?.Size ||
                  message.media?.size ||
                  message.mediaSize,
                IsRead: message.IsRead || message.isRead || false,
                isRead: message.IsRead || message.isRead || false,
                ReadBy:
                  message.ReadBy || message.readBy || message.read_by || [],
                readBy:
                  message.ReadBy || message.readBy || message.read_by || [],
                ReadByTimestamps:
                  message.ReadByTimestamps ||
                  message.readByTimestamps ||
                  message.read_by_timestamps ||
                  message.ReadByTimestamps ||
                  {},
                readByTimestamps:
                  message.ReadByTimestamps ||
                  message.readByTimestamps ||
                  message.read_by_timestamps ||
                  message.ReadByTimestamps ||
                  {},
                ReplyTo:
                  message.ReplyTo ||
                  message.replyTo ||
                  message.ParentMessageId ||
                  message.parentMessageId ||
                  null,
                replyTo:
                  message.ReplyTo ||
                  message.replyTo ||
                  message.ParentMessageId ||
                  message.parentMessageId ||
                  null,
                ParentMessageId:
                  message.ReplyTo ||
                  message.replyTo ||
                  message.ParentMessageId ||
                  message.parentMessageId ||
                  null,
                parentMessageId:
                  message.ReplyTo ||
                  message.replyTo ||
                  message.ParentMessageId ||
                  message.parentMessageId ||
                  null,
                ChatId: message.ChatId || message.chatId || chatId,
                chatId: message.ChatId || message.chatId || chatId,
                status: message.status || message.Status || 'sent',
                isGroup: message.isGroup || message.IsGroup || false,
                // Preserve original data
                _originalData: message,
              };
            })
            .sort((a, b) => {
              // Sort by timestamp ascending (oldest first)
              return (
                new Date(a.Timestamp || a.timestamp || 0) -
                new Date(b.Timestamp || b.timestamp || 0)
              );
            });

          // Return messages with pagination info
          // RTK Query doesn't support returning extra metadata directly,
          // so we'll attach it to the first message for now
          // The hook will extract it
          const result =
            transformedMessages.length > 0
              ? transformedMessages.map((msg, index) => ({
                  ...msg,
                  _nextCursor: index === 0 ? nextCursor : undefined, // Attach to first message
                  _hasMore: nextCursor !== null && nextCursor !== undefined,
                }))
              : [];

          return {
            data: result,
            // Also return metadata separately (though RTK Query will ignore this)
            meta: {
              nextCursor,
              hasMore: nextCursor !== null && nextCursor !== undefined,
            },
          };
        } catch (error) {
          // Handle different types of errors
          const errorMessage = error.message || error.toString();
          const isNetworkError =
            errorMessage.includes('Network request failed') ||
            errorMessage.includes('Failed to fetch') ||
            errorMessage.includes('network') ||
            errorMessage.includes('ECONNREFUSED') ||
            errorMessage.includes('timeout');

          if (__DEV__) {
            if (isNetworkError) {
              console.warn(
                'âš ï¸ Network error fetching messages (server may be unreachable):',
                errorMessage,
              );
            } else {
            }
          }

          // Return empty array on any error - app continues to work
          // WebSocket messages will still be received if connection is active
          return { data: [] };
        }
      },
      providesTags: (result, error, args) => {
        const chatId = args?.chatId || args;
        return [{ type: 'Chat', id: chatId }];
      },
    }),

    registerPushToken: builder.mutation({
      query: ({ token, device }) => {
        const payload = {
          token,
          platform: device?.platform || Platform.OS,
          osVersion: device?.osVersion || Platform.Version?.toString(),
        };

        // Log the exact payload being sent (for debugging)
        if (__DEV__) {
          console.log('[API] registerPushToken - Sending payload:', {
            tokenLength: token?.length,
            tokenPreview: token?.substring(0, 30) + '...',
            platform: payload.platform,
            osVersion: payload.osVersion,
          });
        }

        return {
          url: '/api/users/registerPushToken',
          method: 'POST',
          body: payload,
        };
      },
      invalidatesTags: [{ type: 'DeviceToken', id: 'CURRENT' }],
    }),

    removePushToken: builder.mutation({
      query: ({ token }) => ({
        url: '/api/users/registerPushToken',
        method: 'DELETE',
        body: { token },
      }),
      invalidatesTags: [{ type: 'DeviceToken', id: 'CURRENT' }],
    }),

    getNotifications: builder.query({
      query: (params = {}) => {
        const { limit } = params;
        const queryParams = new URLSearchParams();
        if (limit) {
          queryParams.append('limit', limit.toString());
        }
        const queryString = queryParams.toString();
        return `/api/notifications${queryString ? `?${queryString}` : ''}`;
      },
      transformResponse: response => {
        const notificationsArray = Array.isArray(response)
          ? response
          : response?.data && Array.isArray(response.data)
          ? response.data
          : [];

        return notificationsArray.map((notification, index) => {
          const notificationId =
            notification._id?.$oid ||
            notification._id ||
            notification.id ||
            `notification-${index}`;

          const createdAt =
            notification.createdAt ||
            notification.CreatedAt ||
            notification.timestamp ||
            notification.Timestamp ||
            notification.updatedAt ||
            notification.UpdatedAt ||
            new Date().toISOString();

          return {
            id: notificationId,
            _id: notificationId,
            title: notification.Title || notification.title || 'Notification',
            message: notification.Body || notification.body || '',
            type: notification.Type || notification.type || 'system_alert',
            link: notification.Link || notification.link || '',
            // Extract navigation-related fields from raw notification
            enquiryId:
              notification.EnquiryId ||
              notification.enquiryId ||
              notification.Enquiry ||
              notification.enquiry?._id ||
              notification.Enquiry?._id ||
              null,
            chatId:
              notification.ChatId ||
              notification.chatId ||
              notification.Chat ||
              notification.chat?._id ||
              notification.Chat?._id ||
              null,
            clientId:
              notification.ClientId ||
              notification.clientId ||
              notification.Client ||
              notification.client?._id ||
              notification.Client?._id ||
              null,
            chatType: notification.ChatType || notification.chatType || null,
            designType:
              notification.DesignType || notification.designType || null,
            isRead:
              notification.Read ??
              notification.read ??
              notification.IsRead ??
              notification.isRead ??
              false,
            timestamp: createdAt,
            createdAt,
            raw: notification,
          };
        });
      },
      providesTags: result =>
        result && result.length
          ? [
              ...result.map(notification => ({
                type: 'Notification',
                id: notification.id,
              })),
              { type: 'Notification', id: 'LIST' },
            ]
          : [{ type: 'Notification', id: 'LIST' }],
    }),

    getUnreadNotificationsCount: builder.query({
      query: () => '/api/notifications/unread-count',
      transformResponse: response => {
        if (typeof response === 'number') {
          return response;
        }
        if (response?.count !== undefined) {
          return response.count;
        }
        return 0;
      },
      providesTags: [{ type: 'Notification', id: 'UNREAD_COUNT' }],
    }),

    markNotificationRead: builder.mutation({
      query: notificationId => ({
        url: `/api/notifications/${notificationId}/read`,
        method: 'PATCH',
      }),
      invalidatesTags: (result, error, notificationId) => [
        { type: 'Notification', id: notificationId },
        { type: 'Notification', id: 'LIST' },
        { type: 'Notification', id: 'UNREAD_COUNT' },
      ],
    }),

    markAllNotificationsRead: builder.mutation({
      query: () => ({
        url: '/api/notifications/mark-all-read',
        method: 'POST',
      }),
      invalidatesTags: [
        { type: 'Notification', id: 'LIST' },
        { type: 'Notification', id: 'UNREAD_COUNT' },
      ],
    }),

    // Upload media for chat messages
    uploadChatMedia: builder.mutation({
      queryFn: async (file, { dispatch }, extraOptions, baseQuery) => {
        try {
          const token = await secureStorage.getItem('token');
          if (!token) {
            return {
              error: {
                status: 'CUSTOM_ERROR',
                data: 'Authentication token not found',
              },
            };
          }

          // Create FormData
          const formData = new FormData();
          // Determine default type based on file extension or provided type
          let defaultType = 'image/jpeg';
          let defaultName = `file_${Date.now()}.jpg`;
          if (file.type?.startsWith('audio/')) {
            defaultType = file.type || 'audio/mp3';
            defaultName = file.name || `audio_${Date.now()}.mp3`;
          } else if (file.type?.startsWith('video/')) {
            defaultType = file.type || 'video/mp4';
            defaultName = file.name || `video_${Date.now()}.mp4`;
          } else if (file.name) {
            // Try to infer from filename
            const ext = file.name.split('.').pop()?.toLowerCase();
            if (['mp3', 'm4a', 'wav', 'aac', 'ogg'].includes(ext)) {
              defaultType = `audio/${
                ext === 'm4a' ? 'm4a' : ext === 'ogg' ? 'ogg' : 'mp3'
              }`;
              defaultName = file.name;
            } else if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) {
              defaultType = 'video/mp4';
              defaultName = file.name;
            }
          }

          formData.append('file', {
            uri: file.uri,
            type: file.type || defaultType,
            name: file.name || defaultName,
          });

          const endpoint = '/api/message/upload';

          if (__DEV__) {
            console.log('[uploadChatMedia] request', {
              endpoint,
              uri: file.uri,
              type: file.type,
              name: file.name,
            });
          }

          const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              // Don't set Content-Type - let fetch set it with boundary for FormData
            },
            body: formData,
          });

          if (response.ok) {
            const data = await response.json();
            if (__DEV__) {
              console.log('[uploadChatMedia] success', data);
              if (typeof data === 'string') {
                console.log('[uploadChatMedia] success (string key)', data);
              }
            }
            return { data };
          } else {
            const errorText = await response.text().catch(() => '');
            const errorData = errorText
              ? JSON.parse(errorText)
              : { message: 'Upload failed' };
            if (__DEV__) {
              console.log(
                '[uploadChatMedia] failed',
                response.status,
                errorData,
              );
            }
            return {
              error: {
                status: response.status,
                data: errorData,
              },
            };
          }
        } catch (error) {
          if (__DEV__) {
            console.log('[uploadChatMedia] exception', error);
          }
          return {
            error: {
              status: 'CUSTOM_ERROR',
              data: error.message || 'Failed to upload media',
            },
          };
        }
      },
    }),
  }),
});

// Export hooks for usage in components
export const {
  // Auth
  useLoginMutation,
  useCreateUserMutation,
  useGetUserByIdQuery,
  useUpdateUserMutation,
  useDeleteUserMutation,
  useGetUsersQuery,

  // Enquiry Parsing
  useParseEnquiryMutation,
  useSubmitEnquiryMutation,

  // Enquiries
  useGetEnquiriesQuery,
  useGetEnquiryByIdQuery,
  useLazyGetEnquiryByIdQuery,
  useCreateEnquiryMutation,
  useUpdateEnquiryMutation,
  useDeleteEnquiryMutation,

  // Clients
  useGetClientsQuery,
  useGetDepartmentsQuery,
  useGetClientByIdQuery,
  useCreateClientMutation,
  useUpdateClientPricingMutation,
  useImagepriceDataMutation,
  useJwelleryPriceDataMutation,

  // Dashboard
  useGetDashboardDataQuery,

  // Status Statistics
  useGetStatusStatisticsQuery,
  useGetEnquiryBucketsQuery,

  // Metal Prices
  useGetMetalPricesQuery,
  useGetMetalPriceHistoryQuery,
  useAddMetalPriceMutation,
  useUpdateMetalPriceMutation,
  useDeleteMetalPriceMutation,

  // Pricing
  useCalculatePricingMutation,
  useSavePricingMutation,

  // File Upload
  useUploadImageMutation,
  useUploadReferenceImagesMutation,
  useUploadDesignMutation,
  useValidateImageUploadMutation,
  useUpdateAssetDescriptionMutation,
  useApproveDesignVersionMutation,
  useRejectDesignVersionMutation,
  useUpdateShowToClientMutation,
  useDeleteDesignVersionMutation,

  // Notifications
  useGetNotificationsQuery,
  useGetUnreadNotificationsCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useRegisterPushTokenMutation,
  useRemovePushTokenMutation,

  // Chats
  useGetChatsQuery,
  useGetChatByEnquiryQuery,
  useGetChatsByEnquiryV2Query,
  useGetChatMessagesQuery,
  useUploadChatMediaMutation,

  // Code Lists
  useGetRolesQuery,
  useGetStatusesQuery,
  useGetStoneTypesQuery,
} = api;
