
import axios from 'axios';

export const axiosInstance = axios.create({
    baseURL: 'https://statsapi.web.nhl.com/api/v1'
});


export function handleAxiosError(error, endpoint) {
    let errorMessage = '';
    switch(error.code) {
        case 400:
            errorMessage = `Bad Request to ${endpoint}`;
            break;
        case 401:
            errorMessage = `Unauthorized Request to ${endpoint}`;
            break;            
        case 403:
            errorMessage = `Request FORBIDDEN to ${endpoint}`;
            break;
        case 404:
            errorMessage = `Endpoint not found: ${endpoint}`;
            break;
        // add more error codes here
        default:
            errorMessage = `Something went wrong with request to ${endpoint}; CODE ${error.code}`;
        errorMessage += `; Message: ${error.message}`;
        throw new Error(errorMessage);
    }
}
