import { createSlice } from '@reduxjs/toolkit';
import { TAB } from '../../constants/enquiry';

const initialState = {
  activeTab: TAB.WIP,
    filters: {
      unassigned: false,
      priority: 'all',
      category: 'all',
      clientId: 'all',
      assignedTo: 'all',
      stoneType: 'all',
      metalColor: 'all',
      metalQuality: 'all',
      shippingDateFrom: '',
      shippingDateTo: '',
      assignedDateFrom: '',
      assignedDateTo: '',
      createdDateFrom: '',
      createdDateTo: '',
    },
  searchQuery: '',
  sortBy: 'Priority',
  sortOrder: 'asc',
  selectedEnquiryId: null,
  selectedClient: 'All',
};

const enquiriesSlice = createSlice({
  name: 'enquiries',
  initialState,
  reducers: {
    setActiveTab: (state, action) => {
      state.activeTab = action.payload;
      if (action.payload === TAB.WIP || action.payload === TAB.APPROVAL) {
        state.filters.unassigned = false;
      }
    },
    setFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    setSearchQuery: (state, action) => {
      state.searchQuery = action.payload;
    },
    setSorting: (state, action) => {
      state.sortBy = action.payload.sortBy;
      state.sortOrder = action.payload.sortOrder;
    },
    setSelectedEnquiry: (state, action) => {
      state.selectedEnquiryId = action.payload;
    },
    setSelectedClient: (state, action) => {
      state.selectedClient = action.payload;
    },
    clearFilters: (state) => {
      state.filters = initialState.filters;
      state.searchQuery = '';
      state.selectedClient = 'All';
    },
  },
});

export const {
  setActiveTab,
  setFilters,
  setSearchQuery,
  setSorting,
  setSelectedEnquiry,
  setSelectedClient,
  clearFilters,
} = enquiriesSlice.actions;

export default enquiriesSlice.reducer;
